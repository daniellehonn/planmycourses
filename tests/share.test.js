// Share links carry the whole course list, plan, and settings in the URL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanner } = require('./helpers/planner');
const { SAMPLE } = require('./fixtures');

async function sharedLinkFromPlannedSample() {
    const planner = await createPlanner({ terms: 16, speed: 'fastest', maxUnits: 18 }).load(SAMPLE);
    planner.runHeuristic();
    planner.run(`moveCourse('GE 1', 'unassigned'); handlePinToggle('CS 35L')`);
    await planner.run('sharePlan()');
    return { planner, link: planner.clipboard.text };
}

test('a share link reopens the same plan and settings elsewhere', async () => {
    const { planner, link } = await sharedLinkFromPlannedSample();
    assert.ok(link.startsWith('https://planner.test/#plan=z'), link.slice(0, 40));
    assert.ok(link.length < 8000, `link is ${link.length} characters`);
    assert.equal(planner.status().kind, 'success');

    // A different device: default settings, nothing saved
    const other = createPlanner({ terms: 8, system: 'semester', hash: link.slice(link.indexOf('#')) });
    await other.run('handleSharedLinkOnLoad()');
    const a = planner.snapshot();
    const b = other.snapshot();
    assert.deepEqual(b.terms.map(t => [t.id, [...t.classes].sort(), [...t.pinned].sort(), t.locked]),
        a.terms.map(t => [t.id, [...t.classes].sort(), [...t.pinned].sort(), t.locked]));
    assert.deepEqual(b.courses, a.courses);
    assert.equal(other.run('currentAcademicSystem'), 'quarter');
    assert.equal(other.run('planningSpeed'), 'fastest');
    assert.equal(b.maxUnits, a.maxUnits);
    assert.equal(other.location.hash, '', 'the plan is cleared from the address bar');
});

test('opening a link asks before replacing a plan saved in this browser', async () => {
    const { link } = await sharedLinkFromPlannedSample();
    const other = createPlanner({ terms: 12, hash: link.slice(link.indexOf('#')) });
    await other.load('Course Number,Prerequisites,Description,Units\nMINE 1,None,Mine,4');
    await other.run('handleSharedLinkOnLoad()');

    assert.equal(other.status().kind, 'warning');
    assert.deepEqual(other.snapshot().courses.map(c => c.id), ['MINE 1'], 'nothing replaced yet');
    other.status().actions.find(a => a.textContent === 'Open shared plan').onclick();
    assert.equal(other.snapshot().courses.length, 50);
});

test('a damaged link shows an error and changes nothing', async () => {
    const other = createPlanner({ terms: 12, hash: '#plan=zNOT-A-REAL-PLAN' });
    await other.load('Course Number,Prerequisites,Description,Units\nMINE 1,None,Mine,4');
    await other.run('handleSharedLinkOnLoad()');
    assert.equal(other.status().kind, 'error');
    assert.deepEqual(other.snapshot().courses.map(c => c.id), ['MINE 1']);
});
