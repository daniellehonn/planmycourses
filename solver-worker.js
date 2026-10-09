// Runs the optimal planner off the main thread so the page never freezes.
// Message in:  { id, problem, timeLimitSeconds }
// Message out: { id, ok, status, placements, objective, ms, stats } or { id, ok: false, error }
const HIGHS_BASE = 'https://cdn.jsdelivr.net/npm/highs@1.15.3/build/';

importScripts(HIGHS_BASE + 'highs.js', 'solver.js');

const highsReady = Module({ locateFile: file => HIGHS_BASE + file });

// Statuses that still carry a usable (possibly non-optimal) solution
const SOLUTION_STATUSES = new Set(['Optimal', 'Time limit reached', 'Iteration limit reached']);

onmessage = async (event) => {
    const { id, problem, timeLimitSeconds } = event.data;
    try {
        const highs = await highsReady;
        const model = buildPlanModel(problem);
        const start = performance.now();
        const result = highs.solve(model.lp, {
            output_flag: false,
            time_limit: timeLimitSeconds || 10,
            mip_rel_gap: 0
        });
        const ms = performance.now() - start;
        const hasSolution = SOLUTION_STATUSES.has(result.Status) && result.Columns;
        postMessage({
            id,
            ok: !!hasSolution,
            status: result.Status,
            placements: hasSolution ? decodePlanSolution(problem, result.Columns) : null,
            objective: hasSolution ? result.ObjectiveValue : null,
            ms,
            stats: model.stats,
            error: hasSolution ? null : `Solver ended with status: ${result.Status}`
        });
    } catch (err) {
        postMessage({ id, ok: false, error: String((err && err.message) || err) });
    }
};
