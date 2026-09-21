// Tab 6 - Project management: release Gantt, then every story with its due date.
// Dates come from plan.json (releases[].starts_on/ends_on, stories[].due_on and
// due_baseline_on); status comes from progress.json. A story with no due_on is
// shown as having none, never given an invented one.
(function () {
  'use strict';
  const { el } = CC;

  function gantt(plan, rowsById) {
    const releases = plan.releases || [];
    const markers = [
      plan.meta && { label: 'Build ends', date: plan.meta.buildEnd },
      plan.meta && { label: 'Demo day', date: plan.meta.demoDay },
      { label: 'Today', date: new Date().toISOString().slice(0, 10) },
    ].filter(Boolean);
    const layout = CC.ganttLayout(releases, markers);
    if (!layout.axis) return CC.emptyState('No release in the plan has dates, so there is nothing to draw.');

    const bars = layout.bars.map((b) => {
      const r = b.release;
      const ids = r.story_ids || [];
      const verified = ids.filter((id) => rowsById.get(id) && rowsById.get(id).state === 'verified').length;
      const label = (r.key || r.id) + ' ' + r.name;
      const track = el('div', { class: 'gantt-track' },
        b.undated ? el('span', { class: 'gantt-undated', text: 'no dates in plan' })
          : el('div', { class: 'gantt-bar', style: 'left:' + b.left.toFixed(2) + '%;width:' + b.width.toFixed(2) + '%', title: label + ': ' + r.starts_on + ' to ' + r.ends_on },
              el('span', { class: 'gantt-bar-text', text: verified + '/' + ids.length + ' verified' })),
        ...layout.markers.map((m) => el('div', { class: 'gantt-marker', style: 'left:' + m.left.toFixed(2) + '%', title: m.label + ' ' + m.date })));
      return el('div', { class: 'gantt-row' }, el('div', { class: 'gantt-label', text: label }), track);
    });

    const legend = layout.markers.map((m) => el('span', { class: 'gantt-key' }, el('span', { class: 'gantt-key-line' }), m.label + ' ' + m.date));
    return el('div', { class: 'card gantt' },
      el('div', { class: 'card-head' }, el('div', null, el('div', { class: 'card-eyebrow', text: 'Releases' }), el('div', { class: 'card-title', text: 'Gantt: ' + layout.axis.start + ' to ' + layout.axis.end }))),
      ...bars, el('div', { class: 'gantt-legend' }, legend));
  }

  function releaseCard(r, rowsById, plan) {
    const ids = r.story_ids || [];
    const verified = ids.filter((id) => rowsById.get(id) && rowsById.get(id).state === 'verified').length;
    const detail = [
      r.goal ? el('p', { class: 'detail-text', text: 'Goal: ' + r.goal }) : null,
      r.demo ? el('p', { class: 'detail-text', text: 'Done when you can show: ' + r.demo }) : null,
      CC.row('Window', r.starts_on && r.ends_on ? r.starts_on + ' to ' + r.ends_on : 'no dates in plan'),
      CC.row('Demo target', r.is_demo_target ? 'yes' : 'no'),
      ...ids.map((id) => {
        const row = rowsById.get(id);
        return CC.row(id, row ? row.story.title + ' (' + CC.STATE_LABELS[row.state] + ')' : 'not in plan');
      }),
    ];
    return CC.drillCard({
      eyebrow: 'Release ' + (r.key || r.id), title: r.name,
      summary: verified + ' of ' + ids.length + (ids.length === 1 ? ' story' : ' stories') + ' verified.', detail,
    });
  }

  function taskCard(row, plan) {
    const s = row.story;
    const release = (plan.releases || []).find((r) => (r.key || r.id) === s.release);
    const slip = CC.slippageDays(s.due_on, s.due_baseline_on);
    const dueText = s.due_on ? s.due_on : 'no due date in the plan';
    const criteriaRows = row.criteria.length ? row.criteria : (s.acceptance || []).map((text) => ({ text, passed: null }));

    const detail = [
      el('p', { class: 'detail-text', text: s.narrative }),
      CC.row('Due', dueText),
      CC.row('First promised', s.due_baseline_on || 'not recorded'),
      CC.row('Slippage', slip === null ? 'not tracked (needs due_on and due_baseline_on)' : slip === 0 ? 'none' : (slip > 0 ? slip + ' days later than first promised' : Math.abs(slip) + ' days earlier')),
      release ? CC.row('Release window ends', release.ends_on || 'no date') : null,
      CC.row('Owner', s.owner_agent || 'unassigned'),
      s.blocked_by && s.blocked_by.length ? CC.row('Waits on', s.blocked_by.join(', ')) : null,
      el('div', { class: 'detail-subhead', text: 'Acceptance criteria' }),
      el('ul', { class: 'criteria' }, criteriaRows.map((c) => el('li', { class: c.passed === true ? 'pass' : '' },
        el('span', { class: 'mono', text: c.passed === true ? 'PASS ' : c.passed === false ? 'OPEN ' : 'NOT CHECKED ' }), c.text))),
      row.commitUrl ? el('p', { class: 'detail-text' }, 'Verified commit: ', el('a', { href: row.commitUrl, target: '_blank', rel: 'noopener noreferrer', text: (row.commitSha || '').slice(0, 7) })) : null,
      row.verifiedAt ? CC.row('Verified at', row.verifiedAt) : null,
    ];
    return CC.drillCard({
      eyebrow: s.id + ' · ' + (s.release || 'no release'), title: s.title,
      summary: 'Due: ' + dueText + (row.passed === null ? '' : ' · ' + row.passed + ' of ' + row.total + ' criteria passing'),
      pill: CC.statePill(row.state), detail, className: 'task-card',
    });
  }

  CC.registerTab('Project Management', ({ plan, progress }) => {
    const rows = CC.storyRows(plan, progress);
    const rowsById = new Map(rows.map((r) => [r.story.id, r]));
    const undated = rows.filter((r) => !r.story.due_on).length;
    return CC.tabShell('Project management',
      undated === rows.length && rows.length > 0
        ? 'No story in the plan has a due date yet, so tasks show their release window instead of an invented date. Slippage cannot be tracked until due_on and due_baseline_on are set.'
        : 'Due dates come from the plan; status comes from the verification record.',
      gantt(plan, rowsById),
      el('h3', { class: 'section-heading', text: 'Releases' }),
      el('div', { class: 'card-grid' }, (plan.releases || []).map((r) => releaseCard(r, rowsById, plan))),
      el('h3', { class: 'section-heading', text: 'Every task (' + rows.length + ')' }),
      el('div', { class: 'card-grid' }, rows.map((r) => taskCard(r, plan))));
  });
})();
