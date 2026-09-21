// Shared DOM helpers and the tab registry. All text goes in via textContent,
// never innerHTML, so plan/notes content cannot inject markup.
(function (root) {
  'use strict';
  const CC = (root.CC = root.CC || {});

  CC.el = function (tag, props, ...children) {
    const node = document.createElement(tag);
    Object.entries(props || {}).forEach(([k, v]) => {
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') node.className = v;
      else if (k === 'text') node.textContent = v;
      else node.setAttribute(k, v === true ? '' : v);
    });
    children.flat().forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return node;
  };
  const el = CC.el;

  CC.sampleChip = () => el('span', { class: 'sample-chip', text: 'Sample' });
  CC.pill = (text, tone) => el('span', { class: 'pill tone-' + (tone || 'neutral'), text });
  CC.stateTone = (state) => ({ verified: 'good', submitted: 'info', in_progress: 'info' }[state] || 'neutral');
  CC.statePill = (state) => CC.pill(CC.STATE_LABELS[state], CC.stateTone(state));
  CC.row = (label, value) => el('div', { class: 'detail-row' }, el('span', { class: 'detail-label', text: label }), el('span', { class: 'detail-value', text: value }));
  CC.note = (text) => el('p', { class: 'tab-note', text });
  CC.emptyState = (text) => el('div', { class: 'card empty-state' }, el('p', { text }));

  let cardSeq = 0;
  /**
   * A card that drills down one level. The detail is hidden until the card is
   * activated; index.html's setupDisclosure wires click/Enter/Space via wireDisclosures().
   */
  CC.drillCard = function ({ eyebrow, title, summary, pill, sample, detail, className }) {
    const id = 'cc-detail-' + ++cardSeq;
    const detailBox = el('div', { class: 'card-detail', id, hidden: true }, detail);
    ['click', 'keydown'].forEach((evt) => detailBox.addEventListener(evt, (e) => e.stopPropagation()));
    return el('div', { class: 'card ' + (className || ''), 'data-detail': id },
      el('div', { class: 'card-head' },
        el('div', null, eyebrow ? el('div', { class: 'card-eyebrow', text: eyebrow }) : null, el('div', { class: 'card-title', text: title })),
        el('div', { class: 'card-head-right' }, sample ? CC.sampleChip() : null, pill || null)),
      summary ? (typeof summary === 'string' ? el('p', { class: 'card-summary', text: summary }) : summary) : null,
      el('div', { class: 'card-toggle-hint', text: 'Show detail' }),
      detailBox);
  };

  CC.wireDisclosures = function (container) {
    container.querySelectorAll('.card[data-detail]').forEach((card) => setupDisclosure(card, card.dataset.detail));
  };

  // ---- tab registry -------------------------------------------------
  const renderers = new Map();
  const mounted = new Map();

  /** Register a tab. `render(ctx)` returns a Node; ctx = {plan, progress, manifest, mode, notes}. */
  CC.registerTab = (label, render) => renderers.set(label, render);
  CC.hasTab = (label) => renderers.has(label);

  CC.mountTab = function (label, container) {
    mounted.set(label, container);
    CC.renderTab(label);
  };

  CC.renderTab = function (label) {
    const container = mounted.get(label);
    const render = renderers.get(label);
    if (!container || !render) return;
    container.replaceChildren();
    try {
      container.appendChild(render(CC.context()));
    } catch (err) {
      // Failure path: show the failure on the tab instead of leaving it blank.
      console.error('command-center tab render failed', label, err);
      container.appendChild(el('div', { class: 'card empty-state', role: 'alert' },
        el('p', { text: 'This tab failed to render: ' + (err && err.message ? err.message : String(err)) })));
    }
    CC.wireDisclosures(container);
  };

  CC.rerenderAll = () => mounted.forEach((_, label) => CC.renderTab(label));

  CC.context = () => ({ plan: PLAN, progress: PROGRESS, manifest: MANIFEST, mode: getMode(), notes: CC.notes || [] });

  CC.loadNotes = async function () {
    try {
      const res = await fetch('notes.json', { cache: 'no-store' });
      if (!res.ok) throw new Error('notes.json responded ' + res.status);
      const data = await res.json();
      CC.notes = Array.isArray(data.notes) ? data.notes : [];
    } catch (err) {
      console.error('command-center notes failed to load', err);
      CC.notes = [];
      CC.notesError = String(err.message || err);
    }
  };

  /** Standard tab wrapper: a heading line plus a card grid. */
  CC.tabShell = (heading, intro, ...body) =>
    el('div', { class: 'tab-body' }, el('h2', { class: 'tab-heading', text: heading }), intro ? CC.note(intro) : null, ...body);
})(window);
