// Tab 2 - Outcomes: the numbers this build has to move. The project files hold
// the target, never the measurement, so real mode says "not measured yet".
(function () {
  'use strict';
  const { el } = CC;
  const SVG_NS = 'http://www.w3.org/2000/svg';

  function sparkline(series) {
    const w = 220, h = 56, pad = 6;
    const pts = CC.sparkPoints(series.points.map((p) => p.value), w, h, pad);
    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + w + ' ' + h);
    svg.setAttribute('class', 'sparkline');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Sample trend from ' + series.points[0].value + ' to ' + series.points[series.points.length - 1].value + ' ' + series.unit + '. Illustrative only.');
    const line = document.createElementNS(SVG_NS, 'polyline');
    line.setAttribute('points', pts.map((p) => p.join(',')).join(' '));
    line.setAttribute('fill', 'none');
    line.setAttribute('stroke', 'currentColor');
    line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
    return svg;
  }

  function measureCard(measure, ctx) {
    const { plan, progress, mode } = ctx;
    const req = (plan.requirements || []).find((r) => r.id === measure.id);
    const cov = req ? CC.coverage(req, CC.indexProgress(progress)) : null;
    const series = mode === 'sample' && plan.sample && plan.sample.measures && plan.sample.measures[measure.id];

    const summary = series
      ? el('div', null, sparkline(series),
          el('p', { class: 'card-summary', text: 'Illustrative trend toward the target of ' + series.target + ' ' + (series.target === 1 ? series.unit.replace(/s$/, '') : series.unit) + '. Made up, never measured.' }))
      : el('div', null, el('div', { class: 'big-figure muted', text: 'Not measured yet' }),
          el('p', { class: 'card-summary', text: 'The plan records what was promised, not how far it has moved.' }));

    const detail = [
      CC.row('Requirement', measure.id),
      el('p', { class: 'detail-text', text: measure.statement }),
      CC.row('Measured value', 'none recorded'),
      el('p', { class: 'detail-text', text: 'How it will be calculated: this figure has to come from the running system once it measures real decision times. Nothing in .colaberry/ holds it, so this page shows none rather than a zero.' }),
      cov ? CC.row('Fulfilled by', cov.states.length ? cov.states.map((s) => s.id + ' (' + CC.STATE_LABELS[s.state] + ')').join(', ') : 'no story') : null,
    ];
    if (series) {
      detail.push(el('p', { class: 'detail-text', text: 'Sample points (' + series.unit + '): ' + series.points.map((p) => p.label + ' ' + p.value).join(' / ') }));
    }
    return CC.drillCard({ eyebrow: measure.id, title: measure.statement, summary, sample: !!series, detail });
  }

  CC.registerTab('Outcomes', (ctx) => {
    const measures = (ctx.plan.derived && ctx.plan.derived.measures) || [];
    if (measures.length === 0) return CC.tabShell('Outcomes', null, CC.emptyState('The plan defines no measures yet.'));
    return CC.tabShell('Outcomes: the numbers this has to move',
      'These are the measures committed to. None has been measured yet, and that is correct rather than unfinished.',
      el('div', { class: 'card-grid' }, measures.map((m) => measureCard(m, ctx))));
  });
})();
