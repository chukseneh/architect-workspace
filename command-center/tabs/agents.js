// Tab 7 - AI agents. plan.agents[] is preferred. When the plan carries no scoped
// agent roster, the cards are the story OWNERS and the tab says so: a job title
// is not an AI agent. No run history exists in the files, so none is shown.
(function () {
  'use strict';
  const { el } = CC;

  const listOrNone = (arr, none) => (arr && arr.length ? arr.join('; ') : none);

  function scopedAgentCard(a, rowsById) {
    const owns = (a.owns || []).map((id) => id + (rowsById.get(id) ? ' (' + CC.STATE_LABELS[rowsById.get(id).state] + ')' : ''));
    return CC.drillCard({
      eyebrow: a.trigger_type ? 'Trigger: ' + a.trigger_type : 'Agent', title: a.name,
      summary: (a.purpose || 'No purpose recorded.') + ' No runs recorded.',
      pill: CC.pill(a.autonomy_level || 'autonomy not set', 'neutral'),
      detail: [
        CC.row('Trigger', a.trigger || 'not defined'),
        CC.row('Inputs', listOrNone(a.inputs, 'not defined')),
        CC.row('Outputs', listOrNone(a.outputs, 'not defined')),
        CC.row('Approval gates', listOrNone(a.approval_gates, 'none defined')),
        CC.row('Escalation rules', listOrNone(a.escalation_rules, 'none defined')),
        CC.row('Skills', listOrNone(a.skills, 'no skills registered yet')),
        CC.row('Owns', listOrNone(owns, 'no stories')),
        CC.row('Run history', 'no runs recorded'),
      ],
    });
  }

  function ownerCard(owner, stories, rowsById) {
    const done = stories.filter((s) => rowsById.get(s.id) && rowsById.get(s.id).state === 'verified').length;
    return CC.drillCard({
      eyebrow: 'Story owner', title: owner,
      summary: 'Owns ' + stories.length + (stories.length === 1 ? ' story' : ' stories') + ', ' + done + ' verified. No runs recorded.',
      detail: [
        el('p', { class: 'detail-text', text: 'This is a story owner named in the plan, not a scoped AI agent. Purpose, trigger, inputs, outputs, autonomy level and approval gates are not defined for it.' }),
        ...stories.map((s) => CC.row(s.id, s.title + ' (' + CC.STATE_LABELS[rowsById.get(s.id).state] + ')')),
        CC.row('Skills', 'no skills registered yet'),
        CC.row('Run history', 'no runs recorded'),
      ],
    });
  }

  CC.registerTab('AI Agents', ({ plan, progress }) => {
    const rowsById = new Map(CC.storyRows(plan, progress).map((r) => [r.story.id, r]));
    const scoped = plan.agents || [];
    if (scoped.length) {
      return CC.tabShell('AI agents', 'Agent design as recorded in the plan. Nothing here says an agent has ever run.',
        el('div', { class: 'card-grid' }, scoped.map((a) => scopedAgentCard(a, rowsById))));
    }
    const groups = CC.ownerGroups(plan);
    if (groups.size === 0) return CC.tabShell('AI agents', null, CC.emptyState('The plan has no agents and no story owners.'));
    return CC.tabShell('AI agents',
      'The plan does not carry a scoped agent roster yet, so these cards are the owner of each story. They are owners, not scoped AI agents.',
      el('div', { class: 'card-grid' }, [...groups].map(([owner, stories]) => ownerCard(owner, stories, rowsById))));
  });
})();
