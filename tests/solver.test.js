// Unit tests for the integer-program model in solver.js, on problems small
// enough to know the answer by hand.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { buildPlanModel, decodePlanSolution } = require(path.join(__dirname, '..', 'solver.js'));
const { loadHighs } = require('./helpers/planner');

const terms = (n) => Array.from({ length: n }, (_, j) => ({ id: `t${j}`, order: j, fixedUnits: 0, fixedDifficulty: 0 }));
const course = (id, opts = {}) => ({
    id, units: opts.units ?? 4, difficulty: opts.units ?? 4, required: opts.required ?? true, score: opts.score ?? 0,
    prerequisites: opts.prereqs || [], corequisites: opts.coreqs || [], categories: opts.categories || ['Major Core']
});
const config = { maxUnits: 8, targetUnits: 8, maxDifficulty: 8, overloadPenalty: 20, difficultyPenalty: 10 };

async function solve(problem) {
    const highs = await loadHighs();
    const result = highs.solve(buildPlanModel(problem).lp, { output_flag: false });
    assert.equal(result.Status, 'Optimal');
    return decodePlanSolution(problem, result.Columns);
}

test('a prerequisite chain is spread across consecutive terms', async () => {
    const placements = await solve({
        terms: terms(3), fixed: {}, config,
        courses: [course('A'), course('B', { prereqs: [['A']] }), course('C', { prereqs: [['B']] })]
    });
    assert.deepEqual(placements, { A: 't0', B: 't1', C: 't2' });
});

test('an OR-group needs only one alternative', async () => {
    const placements = await solve({
        terms: terms(2), fixed: { X: -1 }, config,
        courses: [course('B', { prereqs: [['X', 'Y']] })]
    });
    assert.equal(placements.B, 't0');
});

test('required courses win the last seat', async () => {
    const placements = await solve({
        terms: terms(1), fixed: {}, config: { ...config, maxUnits: 4, targetUnits: 4 },
        courses: [course('OPT', { required: false, score: 100 }), course('REQ')]
    });
    assert.deepEqual(placements, { REQ: 't0' });
});

test('corequisites share a term (or come earlier)', async () => {
    const placements = await solve({
        terms: terms(2), fixed: {}, config,
        courses: [course('L', { coreqs: ['LL'] }), course('LL', { units: 1, coreqs: ['L'] })]
    });
    assert.equal(placements.L, placements.LL);
});

test('graduation targets cap how many courses are planned', async () => {
    const placements = await solve({
        terms: terms(2), fixed: {}, config, targets: { GE: { count: 1, units: null } },
        courses: [1, 2, 3].map(i => course(`G${i}`, { required: false, categories: ['GE'] }))
    });
    assert.equal(Object.keys(placements).length, 1);
});

test('the LP text stays small for a realistic plan', () => {
    const courses = Array.from({ length: 50 }, (_, i) => course(`C${i}`, { prereqs: i ? [[`C${i - 1}`]] : [] }));
    const { stats } = buildPlanModel({ terms: terms(12), fixed: {}, config, courses });
    assert.equal(stats.binaries, 600);
    assert.ok(stats.constraints < 2000, `${stats.constraints} constraints`);
});
