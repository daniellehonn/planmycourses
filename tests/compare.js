// Side-by-side comparison of the two planners on every fixture.
//   npm run compare           → table in the terminal
//   npm run compare -- --json → machine-readable results
const { createPlanner } = require('./helpers/planner');
const { checkPlan, planMetrics } = require('./helpers/invariants');
const { FIXTURES } = require('./fixtures');

async function main() {
    const results = [];
    for (const fixture of FIXTURES) {
        for (const engine of ['heuristic', 'optimal']) {
            const planner = createPlanner(fixture.options);
            await planner.load(fixture.csv);
            if (fixture.targets) planner.setTargets(fixture.targets);
            const before = planner.snapshot();
            const run = engine === 'optimal' ? await planner.runOptimal({ timeLimitSeconds: 10 }) : planner.runHeuristic();
            const after = planner.snapshot();
            results.push({
                fixture: fixture.name, engine, ms: Math.round(run.ms), status: run.status,
                violations: checkPlan(before, after).length, ...planMetrics(after)
            });
        }
    }

    if (process.argv.includes('--json')) {
        console.log(JSON.stringify(results, null, 2));
        return;
    }
    const cols = [
        ['fixture', 40], ['engine', 10], ['placed', 8], ['req left', 9], ['finish', 15],
        ['terms', 6], ['max', 5], ['stdev', 6], ['ms', 7], ['broken', 7]
    ];
    const line = (vals) => vals.map((v, i) => String(v).padEnd(cols[i][1])).join(' ');
    console.log(line(cols.map(c => c[0])));
    console.log(line(cols.map(c => '-'.repeat(c[1] - 1))));
    results.forEach(r => console.log(line([
        r.fixture, r.engine, `${r.placed}/${r.total}`, r.requiredUnplaced, r.finishTerm,
        r.termsUsed, r.maxLoad, r.loadStdev, r.ms, r.violations
    ])));
}

main().catch(err => { console.error(err); process.exit(1); });
