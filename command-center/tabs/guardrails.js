// Tab 4 - Guardrails: what must never happen, and whether anything backs it.
// A guardrail counts as kept only when every story that fulfils it is verified
// in progress.json. Otherwise it is a promise made and not yet kept.
(function () {
  'use strict';
  const { el } = CC;

  CC.registerTab('Guardrails', ({ plan, progress }) => {
    const guardrails = (plan.derived && plan.derived.guardrails) || [];
    if (guardrails.length === 0) {
      return CC.tabShell('Guardrails', null, CC.emptyState('The plan has no SAFE requirement, so there are no guardrails to show. That is worth fixing before building further.'));
    }
    const rows = new Map(CC.storyRows(plan, progress).map((r) => [r.story.id, r]));

    const cards = guardrails.map((g) => {
      const st = CC.guardrailStatus(g, plan, progress);
      const detail = [
        el('p', { class: 'detail-text', text: st.reason }),
        ...st.states.map((s) => {
          const row = rows.get(s.id);
          return el('div', { class: 'detail-block' },
            el('div', { class: 'detail-block-head' }, el('span', { class: 'mono', text: s.id }), CC.statePill(s.state)),
            row ? el('p', { class: 'detail-text', text: row.story.title }) : null,
            CC.row('Criteria passing', row && row.passed !== null ? row.passed + ' of ' + row.total : 'not checked yet'));
        }),
        st.states.length === 0 ? CC.row('Fulfilled by', 'no story') : null,
      ];
      return CC.drillCard({
        eyebrow: g.id, title: g.statement, summary: st.reason,
        pill: CC.pill(st.kept ? 'Backed by verified stories' : 'Not yet kept', st.kept ? 'good' : 'neutral'), detail,
      });
    });

    return CC.tabShell('Guardrails: what must never happen',
      'Whether a guardrail is kept is read from the verification state of the stories that fulfil it, never from a claim in this page.',
      el('div', { class: 'card-grid' }, cards));
  });
})();
