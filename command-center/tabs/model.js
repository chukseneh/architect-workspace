// Pure data joins for the Command Center tabs. No DOM in this file, so it can
// be unit-tested in Node (tests/commandCenter/). Everything here derives from
// .colaberry/plan.json + progress.json; nothing is hardcoded plan content.
//
// Contract rule (docs/DATA_CONTRACT.md): completion lives ONLY in
// progress.stories[].verification. Absent verification means "not checked yet",
// which is different from zero.
(function (root) {
  'use strict';
  const CC = (root.CC = root.CC || {});
  const DAY_MS = 86400000;

  CC.STATE_LABELS = {
    verified: 'Verified',
    submitted: 'Submitted',
    in_progress: 'In progress',
    not_started: 'Not started',
    unchecked: 'Not checked yet',
  };

  CC.indexProgress = function (progress) {
    return new Map(((progress && progress.stories) || []).map((s) => [s.id, s]));
  };

  /** A story's state from progress only; 'unchecked' when no verification run exists. */
  CC.stateOf = function (storyId, byId) {
    const v = byId.get(storyId) && byId.get(storyId).verification;
    return v && v.state ? v.state : 'unchecked';
  };

  /** Plan stories joined to progress on id. */
  CC.storyRows = function (plan, progress) {
    const byId = CC.indexProgress(progress);
    return (plan.stories || []).map((story) => {
      const p = byId.get(story.id);
      const v = p && p.verification;
      return {
        story,
        state: CC.stateOf(story.id, byId),
        passed: v ? v.criteria_passed : null,
        total: v ? v.criteria_total : (story.acceptance || []).length,
        criteria: (p && p.criteria) || [],
        commitSha: v ? v.commit_sha : null,
        commitUrl: v ? v.commit_url : null,
        verifiedAt: v ? v.verified_at : null,
      };
    });
  };

  /** How well the stories that fulfil a requirement cover it. */
  CC.coverage = function (req, byId) {
    const ids = req.fulfilled_by || [];
    const states = ids.map((id) => ({ id, state: CC.stateOf(id, byId) }));
    let status;
    if (ids.length === 0) status = 'gap';
    else if (states.every((s) => s.state === 'verified')) status = 'built';
    else if (states.some((s) => s.state === 'verified')) status = 'partial';
    else status = 'unbuilt';
    return { status, states };
  };

  /** A guardrail is only "kept" when every story that fulfils it is verified. */
  CC.guardrailStatus = function (guardrail, plan, progress) {
    const req = (plan.requirements || []).find((r) => r.id === guardrail.id);
    if (!req) return { kept: false, status: 'unknown', states: [], reason: 'Requirement ' + guardrail.id + ' is not in the plan.' };
    const cov = CC.coverage(req, CC.indexProgress(progress));
    const kept = cov.status === 'built';
    let reason;
    if (kept) reason = 'Every story that fulfils it is verified: ' + cov.states.map((s) => s.id).join(', ') + '.';
    else if (cov.status === 'gap') reason = 'A promise made and not yet kept: no story fulfils this guardrail.';
    else reason = 'A promise made and not yet kept: ' + cov.states.filter((s) => s.state !== 'verified')
      .map((s) => s.id + ' is ' + CC.STATE_LABELS[s.state].toLowerCase()).join('; ') + '.';
    return { kept, status: cov.status, states: cov.states, reason, requirement: req };
  };

  /** CONSTRAINT requirements that name a system. */
  CC.systemRequirements = function (name, plan) {
    const n = name.toLowerCase();
    return (plan.requirements || []).filter((r) => r.kind === 'CONSTRAINT' && r.statement.toLowerCase().includes(n));
  };

  /** Stories written "As a <role>, ...". */
  CC.roleStories = function (role, plan) {
    const prefix = new RegExp('^as an? ' + role.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'i');
    return (plan.stories || []).filter((s) => prefix.test(s.narrative || ''));
  };

  /** Stories grouped by their owner_agent, in first-seen order. */
  CC.ownerGroups = function (plan) {
    const groups = new Map();
    (plan.stories || []).forEach((s) => {
      const key = s.owner_agent || 'Unassigned';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(s);
    });
    return groups;
  };

  CC.parseISODate = function (s) {
    if (!s) return null;
    const [y, m, d] = s.split('-').map(Number);
    return Date.UTC(y, m - 1, d);
  };

  /** Days from a to b (ISO date strings); null when either is missing. */
  CC.daysBetweenISO = function (a, b) {
    const x = CC.parseISODate(a);
    const y = CC.parseISODate(b);
    return x === null || y === null ? null : Math.round((y - x) / DAY_MS);
  };

  /** Positive = later than first promised. Null when either date is not in the plan. */
  CC.slippageDays = function (dueOn, baselineOn) {
    return CC.daysBetweenISO(baselineOn, dueOn);
  };

  /**
   * Gantt geometry. Each release becomes {left, width} percentages of the axis
   * that spans every release plus any marker dates. Releases without both dates
   * are returned with `undated: true` rather than being drawn somewhere invented.
   */
  CC.ganttLayout = function (releases, markerDates) {
    const stamps = [];
    releases.forEach((r) => {
      [r.starts_on, r.ends_on].forEach((d) => { const t = CC.parseISODate(d); if (t !== null) stamps.push(t); });
    });
    (markerDates || []).forEach((m) => { const t = CC.parseISODate(m.date); if (t !== null) stamps.push(t); });
    if (stamps.length === 0) return { axis: null, bars: releases.map((r) => ({ release: r, undated: true })), markers: [] };
    const min = Math.min(...stamps);
    const max = Math.max(...stamps);
    const span = Math.max(1, (max - min) / DAY_MS + 1);
    const pos = (t) => ((t - min) / DAY_MS / span) * 100;
    const bars = releases.map((r) => {
      const s = CC.parseISODate(r.starts_on);
      const e = CC.parseISODate(r.ends_on);
      if (s === null || e === null) return { release: r, undated: true };
      return { release: r, undated: false, left: pos(s), width: Math.max(100 / span, ((e - s) / DAY_MS + 1) / span * 100) };
    });
    const markers = (markerDates || [])
      .map((m) => ({ label: m.label, date: m.date, at: CC.parseISODate(m.date) }))
      .filter((m) => m.at !== null)
      .map((m) => ({ label: m.label, date: m.date, left: pos(m.at) }));
    return { axis: { start: new Date(min).toISOString().slice(0, 10), end: new Date(max).toISOString().slice(0, 10) }, bars, markers };
  };

  /** Sample series -> SVG polyline points, y inverted, scaled into a w x h box. */
  CC.sparkPoints = function (values, w, h, pad) {
    if (!values.length) return [];
    const lo = Math.min(...values);
    const hi = Math.max(...values);
    const range = hi - lo || 1;
    return values.map((v, i) => [
      pad + (values.length === 1 ? 0 : (i / (values.length - 1)) * (w - 2 * pad)),
      pad + (1 - (v - lo) / range) * (h - 2 * pad),
    ]);
  };

  /** Problems with the data model block (dangling requirement ids or relationship targets). */
  CC.checkDataModel = function (plan) {
    const problems = [];
    const dm = plan.data_model;
    if (!dm) return ['plan.json has no data_model block'];
    const names = new Set(dm.entities.map((e) => e.name));
    const reqIds = new Set((plan.requirements || []).map((r) => r.id));
    dm.entities.forEach((e) => {
      (e.derived_from || []).forEach((id) => { if (!reqIds.has(id)) problems.push(e.name + ' derives from unknown ' + id); });
      (e.relationships || []).forEach((r) => { if (!names.has(r.to)) problems.push(e.name + ' relates to unknown entity ' + r.to); });
    });
    return problems;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = CC;
})(typeof window !== 'undefined' ? window : globalThis);
