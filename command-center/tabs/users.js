// Tab 3 - Users and use case: the roles the stories are written for.
(function () {
  'use strict';
  const { el } = CC;

  CC.registerTab('Users & Use Case', ({ plan, progress }) => {
    const roles = (plan.derived && plan.derived.roles) || [];
    if (roles.length === 0) return CC.tabShell('Users and use case', null, CC.emptyState('The plan has no roles yet.'));
    const rows = new Map(CC.storyRows(plan, progress).map((r) => [r.story.id, r]));

    const cards = roles.map((role) => {
      const stories = CC.roleStories(role, plan);
      const summary = stories.length
        ? stories.length + (stories.length === 1 ? ' story is' : ' stories are') + ' written for this role.'
        : 'No story is written for this role yet.';
      const detail = stories.length
        ? stories.map((s) => el('div', { class: 'detail-block' },
            el('div', { class: 'detail-block-head' }, el('span', { class: 'mono', text: s.id }), CC.statePill(rows.get(s.id).state)),
            el('p', { class: 'detail-text', text: s.narrative }),
            (s.fulfills && s.fulfills.length) ? CC.row('Fulfils', s.fulfills.join(', ')) : null))
        : [el('p', { class: 'detail-text', text: "This role is in the plan's role list, but no story's \"As a ...\" sentence names it. A story has to be written for it before anything can be shown here." })];
      return CC.drillCard({ eyebrow: 'Role', title: role, summary, detail });
    });

    return CC.tabShell('Users and use case', 'Roles come from the "As a ..." sentence of each story in the plan.',
      el('div', { class: 'card-grid' }, cards));
  });
})();
