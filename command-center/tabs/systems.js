// Tab 5 - Systems: what this connects to. Nothing in the repo can tell whether
// a system is reachable, so every indicator is grey until a running system
// reports otherwise. Sample mode shows illustrative statuses, labelled as such.
(function () {
  'use strict';
  const { el } = CC;

  CC.registerTab('Systems', ({ plan, progress, mode }) => {
    const systems = plan.systems || [];
    if (systems.length === 0) return CC.tabShell('Systems', null, CC.emptyState('The plan names no systems.'));
    const byId = CC.indexProgress(progress);
    const sample = mode === 'sample';

    const cards = systems.map((name) => {
      const status = sample ? (plan.sampleSystemStatus || {})[name] || 'unknown' : 'unknown';
      const label = { connected: 'Connected', not_connected: 'Not connected', error: 'Error' }[status] || 'Not checked from here';
      const tone = status === 'connected' ? 'good' : status === 'error' ? 'bad' : 'neutral';
      const checked = sample && status !== 'unknown' ? 'sample check, not real' : 'never checked';
      const reqs = CC.systemRequirements(name, plan);

      const detail = [
        CC.row('Status', label),
        CC.row('Last checked', checked),
        el('p', { class: 'detail-text', text: "The project files know this system's name and nothing about whether it is reachable. That fact belongs to the running system." }),
        ...reqs.map((r) => {
          const cov = CC.coverage(r, byId);
          return el('div', { class: 'detail-block' },
            el('div', { class: 'detail-block-head' }, el('span', { class: 'mono', text: r.id }),
              CC.pill(cov.status === 'gap' ? 'No story covers it' : cov.status === 'built' ? 'Built' : 'Not fully built', cov.status === 'built' ? 'good' : 'neutral')),
            el('p', { class: 'detail-text', text: r.statement }),
            CC.row('Fulfilled by', cov.states.length ? cov.states.map((s) => s.id + ' (' + CC.STATE_LABELS[s.state] + ')').join(', ') : 'no story'));
        }),
        reqs.length === 0 ? CC.row('Requirement', 'none names this system') : null,
      ];
      return CC.drillCard({
        eyebrow: 'System', title: name, sample: sample && status !== 'unknown',
        summary: el('div', { class: 'system-line' },
          el('span', { class: 'dot ' + (status === 'connected' ? 'connected' : status === 'error' ? 'error' : '') }),
          el('span', { text: label }), el('span', { class: 'system-meta', text: checked })),
        pill: CC.pill(label, tone), detail,
      });
    });

    return CC.tabShell('Systems: what this connects to',
      sample
        ? 'Sample mode: statuses below are illustrative and were never checked.'
        : 'Every indicator is grey and reads "not checked from here" until the running system reports otherwise.',
      el('div', { class: 'card-grid' }, cards));
  });
})();
