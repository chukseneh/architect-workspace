// Tab 9 - Data model: the tables behind the system, derived from the
// requirements and stored in plan.json (data_model). It is a PROPOSAL: no table
// has been created from it, and the tab says so.
(function () {
  'use strict';
  const { el } = CC;

  CC.registerTab('Data Model', ({ plan }) => {
    const dm = plan.data_model;
    if (!dm || !dm.entities || dm.entities.length === 0) {
      return CC.tabShell('Data model', null, CC.emptyState('plan.json has no data_model yet. It has to be derived from the requirements and reviewed before any table is created.'));
    }
    const problems = CC.checkDataModel(plan);

    const cards = dm.entities.map((e) => CC.drillCard({
      eyebrow: 'Entity', title: e.name, summary: e.purpose, pill: CC.pill('Proposed', 'neutral'),
      detail: [
        el('div', { class: 'detail-subhead', text: 'Fields' }),
        el('ul', { class: 'field-list' }, e.fields.map((f) => el('li', { class: 'mono', text: f }))),
        el('div', { class: 'detail-subhead', text: 'Relationships' }),
        e.relationships.length
          ? el('ul', { class: 'field-list' }, e.relationships.map((r) => el('li', { text: r.kind + ' with ' + r.to })))
          : el('p', { class: 'detail-text', text: 'None: this entity stands alone.' }),
        CC.row('Derived from', (e.derived_from || []).join(', ')),
      ],
    }));

    return CC.tabShell('Data model: proposed, not created', dm.note,
      problems.length ? el('div', { class: 'card empty-state', role: 'alert' }, el('p', { text: 'Data model problems: ' + problems.join(' ') })) : null,
      el('div', { class: 'card-grid' }, cards));
  });
})();
