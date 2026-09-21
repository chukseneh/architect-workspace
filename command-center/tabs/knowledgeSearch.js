// Deterministic question answering over the data this page already loaded.
// Not an LLM: a static page cannot hold an API key, and a keyword match that
// cites its source cannot make anything up. If nothing matches, it says so.
// Pure (no DOM) so it is unit-tested in tests/commandCenter/.
(function (root) {
  'use strict';
  const CC = (root.CC = root.CC || {});

  const STOPWORDS = new Set(['the', 'and', 'for', 'are', 'what', 'which', 'who', 'how', 'does', 'this', 'that',
    'with', 'from', 'about', 'there', 'their', 'have', 'has', 'can', 'any', 'all', 'our', 'system', 'tell', 'show',
    'please', 'must', 'was', 'were', 'will', 'when', 'where', 'why', 'not', 'you', 'its', 'into', 'than', 'then',
    'they', 'been', 'would', 'should', 'could', 'some', 'only', 'also', 'more']);
  // A term found in more than this share of entries says nothing about any one of them.
  const COMMON_TERM_SHARE = 0.25;

  function tokens(text) {
    return (text.toLowerCase().match(/[a-z0-9][a-z0-9/-]*/g) || [])
      .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
      .filter((t) => (t.length >= 3 || /\d/.test(t)) && !STOPWORDS.has(t));
  }

  /** One searchable entry per fact the page can show, tagged with the tab it lives on. */
  CC.buildKnowledgeIndex = function (plan, progress, notes) {
    const entries = [];
    const byId = CC.indexProgress(progress);
    const add = (tab, ref, title, text) => entries.push({ tab, ref, title, text });

    (plan.requirements || []).forEach((r) => {
      const cov = CC.coverage(r, byId);
      const cover = cov.status === 'gap' ? 'No story covers it yet.' : 'Covered by ' + cov.states.map((s) => s.id + ' (' + CC.STATE_LABELS[s.state] + ')').join(', ') + '.';
      add('Knowledge base', r.id, r.id, r.id + ' (' + r.kind + ', ' + r.priority + '): ' + r.statement + ' ' + cover);
    });
    CC.storyRows(plan, progress).forEach((row) => {
      const s = row.story;
      add('Project management', s.id, s.id,
        s.id + ' ' + s.title + ' (release ' + s.release + ', owner ' + (s.owner_agent || 'unassigned') + '): ' +
        CC.STATE_LABELS[row.state] + (row.passed === null ? '' : ', ' + row.passed + ' of ' + row.total + ' criteria passing') + '. ' + (s.narrative || ''));
    });
    ((plan.derived && plan.derived.measures) || []).forEach((m) =>
      add('Outcomes', m.id, m.id, m.id + ' is a measure: ' + m.statement + ' No measurement has been recorded in the project files.'));
    ((plan.derived && plan.derived.roles) || []).forEach((role) =>
      add('Users and use case', role, role, 'The plan has a user role: ' + role + '. ' + CC.roleStories(role, plan).map((s) => s.id).join(', ')));
    ((plan.derived && plan.derived.guardrails) || []).forEach((g) => {
      const st = CC.guardrailStatus(g, plan, progress);
      add('Guardrails', g.id, g.id, g.id + ' guardrail: ' + g.statement + ' ' + st.reason);
    });
    (plan.systems || []).forEach((name) =>
      add('Systems', name, name, 'System ' + name + ' is named in the plan. Connection status is not checked from this page.'));
    (plan.releases || []).forEach((r) =>
      add('Project management', r.id, r.id, 'Release ' + r.id + ' ' + r.name + ': ' + (r.goal || '') + ' Runs ' + (r.starts_on || 'undated') + ' to ' + (r.ends_on || 'undated') + '.'));
    CC.ownerGroups(plan).forEach((stories, owner) =>
      add('AI agents', owner, owner, owner + ' owns ' + stories.map((s) => s.id).join(', ') + '. It is a story owner, not a scoped agent.'));
    ((plan.data_model && plan.data_model.entities) || []).forEach((e) =>
      add('Data model', e.name, e.name, 'Proposed entity ' + e.name + ': ' + e.purpose + ' Fields: ' + e.fields.join(', ') + '.'));
    (notes || []).forEach((n) => add('Knowledge base', n.id, n.title, (n.kind || 'note') + ': ' + n.title + '. ' + n.text));
    if (plan.meta) add('Overview', 'schedule', 'Schedule', 'Build ends ' + plan.meta.buildEnd + '. Demo day is ' + plan.meta.demoDay + '.');
    return entries;
  };

  const PROGRESS_INTENT = /\b(progress|how many|verified|points|criteria|done|complete)\b/i;

  /** Returns {answered, text, citations[]}. Never guesses. */
  CC.answerQuestion = function (question, index, progress) {
    const q = (question || '').trim();
    if (!q) return { answered: false, text: 'Ask a question about the plan, stories, requirements, guardrails, systems or data model.', citations: [] };

    const t = progress && progress.totals;
    if (t && PROGRESS_INTENT.test(q) && /(story|stories|criteria|points|progress)/i.test(q)) {
      return {
        answered: true,
        text: t.stories_verified + ' of ' + t.stories_total + ' stories verified; ' + t.criteria_passed + ' of ' + t.criteria_total +
          ' criteria passing; ' + t.points_awarded + ' points awarded. Figures are as of the last sync.',
        citations: [{ tab: 'Overview', ref: 'progress.totals' }],
      };
    }

    const direct = q.match(/\b(req|story)-\d{3}\b/gi);
    if (direct) {
      const wanted = new Set(direct.map((d) => d.toUpperCase()));
      const hits = index.filter((e) => wanted.has(e.ref.toUpperCase())).slice(0, 4);
      if (hits.length) return toAnswer(hits);
    }

    const qt = [...new Set(tokens(q))];
    if (qt.length === 0) return { answered: false, text: 'I cannot answer that from the data on this page.', citations: [] };
    const need = qt.length <= 2 ? 1 : 2;
    const entryTokens = index.map((e) => new Set(tokens(e.title + ' ' + e.text)));
    const distinctive = new Set(qt.filter((w) => entryTokens.filter((s) => s.has(w)).length <= index.length * COMMON_TERM_SHARE));
    const scored = index
      .map((e, i) => ({ e, score: [...distinctive].filter((w) => entryTokens[i].has(w)).length }))
      .filter((x) => x.score >= need)
      .sort((a, b) => b.score - a.score);
    if (scored.length === 0) return { answered: false, text: 'I cannot answer that from the data on this page. Try naming a requirement, story, system or role.', citations: [] };
    return toAnswer(scored.slice(0, 3).map((x) => x.e));
  };

  function toAnswer(entries) {
    return {
      answered: true,
      text: entries.map((e) => e.text).join('\n\n'),
      citations: entries.map((e) => ({ tab: e.tab, ref: e.ref })),
    };
  }

  if (typeof module !== 'undefined' && module.exports) module.exports = CC;
})(typeof window !== 'undefined' ? window : globalThis);
