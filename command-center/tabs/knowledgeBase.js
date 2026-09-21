// Tab 8 - Knowledge base: traceability table (requirement -> stories -> state),
// notes and decisions (read from command-center/notes.json, so it grows by
// adding entries), and a question box that answers only from loaded data.
(function () {
  'use strict';
  const { el } = CC;

  const COVERAGE_TEXT = { gap: 'No story covers this', built: 'Built', partial: 'Partly built', unbuilt: 'Not built yet' };
  const COVERAGE_TONE = { gap: 'bad', built: 'good', partial: 'info', unbuilt: 'neutral' };

  function traceabilityTable(plan, progress) {
    const byId = CC.indexProgress(progress);
    const titles = new Map((plan.stories || []).map((s) => [s.id, s.title]));
    const body = el('tbody');

    (plan.requirements || []).forEach((r, i) => {
      const cov = CC.coverage(r, byId);
      const isRealGap = cov.status === 'gap' && r.priority === 'must';
      const detailId = 'trace-detail-' + i;
      const toggle = el('button', { type: 'button', class: 'row-toggle', 'aria-expanded': 'false', 'aria-controls': detailId, text: r.id });
      const main = el('tr', { class: isRealGap ? 'gap-row' : '' },
        el('td', null, toggle),
        el('td', { text: r.kind + ' / ' + r.priority }),
        el('td', { text: r.statement }),
        el('td', { class: 'mono', text: cov.states.length ? cov.states.map((s) => s.id).join(', ') : 'none' }),
        el('td', null, CC.pill(COVERAGE_TEXT[cov.status] + (isRealGap ? ' (a must-have)' : ''), COVERAGE_TONE[cov.status])));
      const more = el('tr', { id: detailId, class: 'trace-detail', hidden: true },
        el('td', { colspan: '5' },
          CC.row('Cluster', r.cluster || 'not recorded'),
          ...cov.states.map((s) => CC.row(s.id, (titles.get(s.id) || 'not in plan') + ' (' + CC.STATE_LABELS[s.state] + ')')),
          cov.states.length === 0 ? el('p', { class: 'detail-text', text: 'No story lists this requirement in its fulfils. Until one does, nothing in the plan will build it.' }) : null));
      toggle.addEventListener('click', () => {
        more.hidden = !more.hidden;
        toggle.setAttribute('aria-expanded', more.hidden ? 'false' : 'true');
      });
      body.append(main, more);
    });

    return el('div', { class: 'table-wrap' }, el('table', { class: 'trace-table' },
      el('thead', null, el('tr', null, ['Requirement', 'Kind / priority', 'Statement', 'Covered by', 'Status'].map((h) => el('th', { scope: 'col', text: h })))),
      body));
  }

  function notesSection(notes) {
    if (!notes.length) {
      return CC.emptyState(CC.notesError
        ? 'Notes could not be loaded (' + CC.notesError + ').'
        : 'No notes or decisions recorded yet. Add entries to command-center/notes.json and reload.');
    }
    return el('div', { class: 'card-grid' }, notes.map((n) => CC.drillCard({
      eyebrow: (n.kind || 'note') + (n.date ? ' · ' + n.date : ''), title: n.title, summary: n.text,
      detail: [CC.row('Evidence', n.evidence || 'none given')],
    })));
  }

  function askPanel(ctx) {
    const index = CC.buildKnowledgeIndex(ctx.plan, ctx.progress, ctx.notes);
    const log = el('div', { class: 'chat-log', 'aria-live': 'polite' });
    const input = el('input', { type: 'text', id: 'kb-question', class: 'chat-input', placeholder: 'e.g. Which stories cover REQ-013?', autocomplete: 'off' });
    const form = el('form', { class: 'chat-form' },
      el('label', { for: 'kb-question', class: 'chat-label', text: 'Ask about the data on this page' }), input,
      el('button', { type: 'submit', class: 'chat-send', text: 'Ask' }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const q = input.value.trim();
      if (!q) return;
      const a = CC.answerQuestion(q, index, ctx.progress);
      log.append(
        el('div', { class: 'chat-q', text: q }),
        el('div', { class: 'chat-a' + (a.answered ? '' : ' unanswered') },
          el('p', { text: a.text }),
          a.citations.length ? el('p', { class: 'chat-cite', text: 'Source: ' + a.citations.map((c) => c.tab + ' (' + c.ref + ')').join('; ') }) : null));
      input.value = '';
      log.scrollTop = log.scrollHeight;
    });
    return el('div', { class: 'card chat' },
      el('div', { class: 'card-head' }, el('div', null, el('div', { class: 'card-eyebrow', text: 'Ask' }), el('div', { class: 'card-title', text: 'Search this page\'s data' }))),
      CC.note('This is a search over the loaded plan and progress files, not a language model. It cites the tab each answer comes from and says so when it cannot answer.'),
      form, log);
  }

  CC.registerTab('Knowledge Base', (ctx) => CC.tabShell('Knowledge base',
    'Everything the project knows about itself: requirements, stories, decisions and notes.',
    el('h3', { class: 'section-heading', text: 'Traceability: requirements to stories' }),
    traceabilityTable(ctx.plan, ctx.progress),
    el('h3', { class: 'section-heading', text: 'Decisions and notes' }),
    notesSection(ctx.notes),
    el('h3', { class: 'section-heading', text: 'Ask' }),
    askPanel(ctx)));
})();
