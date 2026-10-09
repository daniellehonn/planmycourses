// Runs both planners on every fixture: each plan must satisfy every rule in
// checkPlan, and the optimal planner must do at least as well as the
// heuristic (fewer required courses left out; on a tie, no fewer courses
// placed).
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanner } = require('./helpers/planner');
const { checkPlan, planMetrics } = require('./helpers/invariants');
const { FIXTURES } = require('./fixtures');

async function plan(fixture, engine) {
    const planner = createPlanner(fixture.options);
    await planner.load(fixture.csv);
    if (fixture.targets) planner.setTargets(fixture.targets);
    const before = planner.snapshot();
    // Same limit as the app (SOLVER_TIME_LIMIT_SECONDS)
    const run = engine === 'optimal' ? await planner.runOptimal({ timeLimitSeconds: 10 }) : planner.runHeuristic();
    const after = planner.snapshot();
    return { before, after, run, metrics: planMetrics(after) };
}

for (const fixture of FIXTURES) {
    test(fixture.name, async (t) => {
        const results = {};
        for (const engine of ['heuristic', 'optimal']) {
            await t.test(`${engine} plan follows every rule`, async () => {
                const result = await plan(fixture, engine);
                results[engine] = result;
                assert.deepEqual(checkPlan(result.before, result.after), []);
            });
        }

        await t.test('optimal solver proves optimality', () => {
            // Stress fixtures may stop at the time limit with a valid best-found plan
            const accepted = fixture.stress
                ? ['Optimal', 'Time limit reached']
                : ['Optimal', 'Nothing to place'];
            assert.ok(accepted.includes(results.optimal.run.status),
                `solver status: ${results.optimal.run.status}`);
        });

        await t.test('optimal does at least as well as heuristic', () => {
            const h = results.heuristic.metrics;
            const o = results.optimal.metrics;
            assert.ok(o.requiredUnplaced <= h.requiredUnplaced,
                `required left out: optimal ${o.requiredUnplaced}, heuristic ${h.requiredUnplaced}`);
            if (o.requiredUnplaced === h.requiredUnplaced) {
                assert.ok(o.unplaced <= h.unplaced,
                    `courses left out: optimal ${o.unplaced}, heuristic ${h.unplaced}`);
            }
        });
    });
}
