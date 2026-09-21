// Unit tests for the Command Center's pure data layer (command-center/tabs/).
// Run: node --test tests/commandCenter/
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const tabs = path.join(__dirname, '..', '..', 'command-center', 'tabs');
require(path.join(tabs, 'model.js'));
require(path.join(tabs, 'knowledgeSearch.js'));
const CC = globalThis.CC;

const repo = path.join(__dirname, '..', '..');
const realPlan = JSON.parse(fs.readFileSync(path.join(repo, '.colaberry', 'plan.json'), 'utf8'));
const realProgress = JSON.parse(fs.readFileSync(path.join(repo, '.colaberry', 'progress.json'), 'utf8'));
const realNotes = JSON.parse(fs.readFileSync(path.join(repo, 'command-center', 'notes.json'), 'utf8')).notes;

const plan = {
  requirements: [
    { id: 'REQ-001', kind: 'CONSTRAINT', priority: 'must', statement: 'The system must ingest data from GP practice management software.', fulfilled_by: ['STORY-001'] },
    { id: 'REQ-005', kind: 'CONSTRAINT', priority: 'must', statement: 'The system must ingest data from Staffing rotas.', fulfilled_by: [] },
    { id: 'REQ-013', kind: 'SAFE', priority: 'must', statement: 'The system must flag data uncertainties for human review.', fulfilled_by: ['STORY-001', 'STORY-002'] },
  ],
  stories: [
    { id: 'STORY-001', release: 'r0', title: 'A', narrative: 'As a healthcare analyst, I want x.', acceptance: ['c1'], owner_agent: 'Team A' },
    { id: 'STORY-002', release: 'r0', title: 'B', narrative: 'As an AI architect, I want y.', acceptance: ['c1', 'c2'], owner_agent: 'Team A' },
  ],
  releases: [],
  systems: ['Staffing'],
};
const progress = {
  stories: [
    { id: 'STORY-001', criteria: [], verification: { state: 'verified', criteria_passed: 3, criteria_total: 3 } },
    { id: 'STORY-002', criteria: [], verification: { state: 'in_progress', criteria_passed: 1, criteria_total: 2 } },
  ],
  totals: { stories_verified: 1, stories_total: 2, criteria_passed: 4, criteria_total: 5, points_awarded: 80 },
};

test('stateOf: absent verification is "unchecked", never "not_started"', () => {
  const byId = CC.indexProgress({ stories: [{ id: 'STORY-009', criteria: [] }] });
  assert.equal(CC.stateOf('STORY-009', byId), 'unchecked');
  assert.equal(CC.stateOf('STORY-404', byId), 'unchecked');
});

test('storyRows joins plan to progress on id and keeps null for unmeasured counts', () => {
  const rows = CC.storyRows(plan, { stories: [] });
  assert.equal(rows[0].passed, null);
  assert.equal(rows[0].total, 1);
  const joined = CC.storyRows(plan, progress);
  assert.deepEqual([joined[0].state, joined[0].passed], ['verified', 3]);
});

test('coverage: gap / built / partial / unbuilt', () => {
  const byId = CC.indexProgress(progress);
  assert.equal(CC.coverage(plan.requirements[1], byId).status, 'gap');
  assert.equal(CC.coverage(plan.requirements[0], byId).status, 'built');
  assert.equal(CC.coverage(plan.requirements[2], byId).status, 'partial');
  assert.equal(CC.coverage({ fulfilled_by: ['STORY-002'] }, byId).status, 'unbuilt');
});

test('guardrailStatus: only kept when every fulfilling story is verified, and says so in words', () => {
  const kept = CC.guardrailStatus({ id: 'REQ-001' }, plan, progress);
  assert.equal(kept.kept, true);
  const notKept = CC.guardrailStatus({ id: 'REQ-013' }, plan, progress);
  assert.equal(notKept.kept, false);
  assert.match(notKept.reason, /promise made and not yet kept/);
  assert.match(notKept.reason, /STORY-002 is in progress/);
  const gap = CC.guardrailStatus({ id: 'REQ-005' }, plan, progress);
  assert.equal(gap.kept, false);
  assert.match(gap.reason, /no story fulfils/);
});

test('guardrailStatus: a guardrail id missing from the plan is not silently kept', () => {
  const r = CC.guardrailStatus({ id: 'REQ-999' }, plan, progress);
  assert.equal(r.kept, false);
  assert.equal(r.status, 'unknown');
});

test('systemRequirements matches only CONSTRAINT requirements naming the system', () => {
  assert.deepEqual(CC.systemRequirements('Staffing', plan).map((r) => r.id), ['REQ-005']);
  assert.deepEqual(CC.systemRequirements('Hospital', plan), []);
});

test('roleStories handles "a"/"an" and regex characters in the role', () => {
  assert.deepEqual(CC.roleStories('AI architect', plan).map((s) => s.id), ['STORY-002']);
  assert.deepEqual(CC.roleStories('healthcare analyst', plan).map((s) => s.id), ['STORY-001']);
  assert.deepEqual(CC.roleStories('UI/UX designer', plan), []);
  assert.deepEqual(CC.roleStories('a.*', plan), []);
});

test('ownerGroups groups by owner and buckets a missing owner as Unassigned', () => {
  const g = CC.ownerGroups({ stories: [...plan.stories, { id: 'S3', narrative: '' }] });
  assert.deepEqual([...g.keys()], ['Team A', 'Unassigned']);
  assert.equal(g.get('Team A').length, 2);
});

test('slippageDays: positive when later, null when either date is missing', () => {
  assert.equal(CC.slippageDays('2026-09-10', '2026-09-03'), 7);
  assert.equal(CC.slippageDays('2026-09-03', '2026-09-03'), 0);
  assert.equal(CC.slippageDays(null, '2026-09-03'), null);
  assert.equal(CC.slippageDays('2026-09-10', null), null);
});

test('slippageDays is not thrown off by a daylight-saving boundary', () => {
  assert.equal(CC.daysBetweenISO('2026-03-28', '2026-03-30'), 2);
  assert.equal(CC.daysBetweenISO('2026-10-24', '2026-10-26'), 2);
});

test('ganttLayout: positions within 0-100 and flags undated releases instead of drawing them', () => {
  const layout = CC.ganttLayout(
    [{ starts_on: '2026-08-01', ends_on: '2026-08-10' }, { starts_on: '2026-08-21', ends_on: '2026-08-30' }, { starts_on: null, ends_on: null }],
    [{ label: 'Demo', date: '2026-08-30' }]);
  assert.equal(layout.axis.start, '2026-08-01');
  assert.equal(layout.axis.end, '2026-08-30');
  assert.equal(layout.bars[0].left, 0);
  layout.bars.filter((b) => !b.undated).forEach((b) => assert.ok(b.left >= 0 && b.left + b.width <= 100.0001));
  assert.equal(layout.bars[2].undated, true);
  // A marker sits at the start of its day; the bar ending that day fills through the end of it.
  assert.ok(Math.abs(layout.markers[0].left - (29 / 30) * 100) < 1e-9);
});

test('ganttLayout: no dates anywhere yields no axis (boundary: empty input)', () => {
  assert.equal(CC.ganttLayout([], []).axis, null);
  assert.equal(CC.ganttLayout([{ starts_on: null, ends_on: null }], []).bars[0].undated, true);
});

test('sparkPoints: flat series does not divide by zero; empty series is empty', () => {
  assert.deepEqual(CC.sparkPoints([], 100, 50, 5), []);
  const flat = CC.sparkPoints([2, 2, 2], 100, 50, 5);
  flat.forEach(([x, y]) => assert.ok(Number.isFinite(x) && Number.isFinite(y)));
  assert.equal(CC.sparkPoints([5], 100, 50, 5).length, 1);
});

test('checkDataModel reports dangling requirement ids and relationship targets', () => {
  const bad = { requirements: [{ id: 'REQ-001' }], data_model: { entities: [
    { name: 'A', derived_from: ['REQ-001', 'REQ-999'], relationships: [{ to: 'B' }] }] } };
  const problems = CC.checkDataModel(bad);
  assert.equal(problems.length, 2);
  assert.deepEqual(CC.checkDataModel({ requirements: [] }), ['plan.json has no data_model block']);
});

// ---- knowledge search ---------------------------------------------------

const index = CC.buildKnowledgeIndex(plan, progress, []);

test('answerQuestion: direct requirement lookup cites its tab', () => {
  const a = CC.answerQuestion('what is REQ-013?', index, progress);
  assert.equal(a.answered, true);
  assert.match(a.text, /flag data uncertainties/);
  assert.deepEqual(a.citations[0], { tab: 'Knowledge base', ref: 'REQ-013' });
});

test('answerQuestion: progress questions come from progress.totals', () => {
  const a = CC.answerQuestion('how many stories are verified?', index, progress);
  assert.match(a.text, /1 of 2 stories verified/);
  assert.equal(a.citations[0].tab, 'Overview');
});

test('answerQuestion: refuses rather than guessing when nothing matches', () => {
  const a = CC.answerQuestion('what is the weather in Leeds tomorrow', index, progress);
  assert.equal(a.answered, false);
  assert.match(a.text, /cannot answer/);
  assert.deepEqual(a.citations, []);
});

test('answerQuestion: empty and stopword-only input are not answered', () => {
  assert.equal(CC.answerQuestion('', index, progress).answered, false);
  assert.equal(CC.answerQuestion('   ', index, progress).answered, false);
  assert.equal(CC.answerQuestion('the and for', index, progress).answered, false);
});

test('answerQuestion is idempotent: same question, same answer', () => {
  const q = 'which stories cover staffing rotas';
  assert.deepEqual(CC.answerQuestion(q, index, progress), CC.answerQuestion(q, index, progress));
});

// ---- the real project files ---------------------------------------------

test('real plan.json: every guardrail, story and fulfilled_by id resolves', () => {
  const reqIds = new Set(realPlan.requirements.map((r) => r.id));
  const storyIds = new Set(realPlan.stories.map((s) => s.id));
  realPlan.derived.guardrails.forEach((g) => assert.ok(reqIds.has(g.id), g.id));
  realPlan.derived.measures.forEach((m) => assert.ok(reqIds.has(m.id), m.id));
  realPlan.requirements.forEach((r) => r.fulfilled_by.forEach((id) => assert.ok(storyIds.has(id), id)));
  realPlan.stories.forEach((s) => s.fulfills.forEach((id) => assert.ok(reqIds.has(id), id)));
});

test('real plan.json: data model has no dangling references', () => {
  assert.deepEqual(CC.checkDataModel(realPlan), []);
});

test('real plan.json: no hard-coded enforcement claim survives', () => {
  assert.equal('guardrails' in realPlan, false);
});

test('real plan.json: sample data is labelled as illustrative', () => {
  assert.match(realPlan.sample.label, /never measured/);
  Object.keys(realPlan.sample.measures).forEach((id) => assert.ok(realPlan.requirements.some((r) => r.id === id), id));
});

test('real files: every plan story has a progress entry to join to', () => {
  const ids = new Set(realProgress.stories.map((s) => s.id));
  realPlan.stories.forEach((s) => assert.ok(ids.has(s.id), s.id));
});

test('real notes.json: every note has the fields the tab renders, including evidence', () => {
  assert.ok(realNotes.length > 0);
  realNotes.forEach((n) => ['id', 'kind', 'date', 'title', 'text', 'evidence'].forEach((f) => assert.ok(n[f], n.id + ' missing ' + f)));
});

test('real files: the search index answers a real question with a citation', () => {
  const idx = CC.buildKnowledgeIndex(realPlan, realProgress, realNotes);
  const a = CC.answerQuestion('which story covers REQ-013', idx, realProgress);
  assert.equal(a.answered, true);
  assert.ok(a.citations.length > 0);
});

test('real files: an off-topic question is refused, not matched on filler words', () => {
  const idx = CC.buildKnowledgeIndex(realPlan, realProgress, realNotes);
  ['what is the weather in Leeds tomorrow', 'is it in the plan to order pizza', 'who won the football'].forEach((q) => {
    const a = CC.answerQuestion(q, idx, realProgress);
    assert.equal(a.answered, false, q);
  });
});

test('real files: a system question finds the system and cites the Systems tab', () => {
  const idx = CC.buildKnowledgeIndex(realPlan, realProgress, realNotes);
  const a = CC.answerQuestion('is Staffing connected', idx, realProgress);
  assert.equal(a.answered, true);
  assert.ok(a.citations.some((c) => c.tab === 'Systems'));
});
