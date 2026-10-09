// Optimal planner: builds a mixed-integer program (CPLEX LP text) for the
// HiGHS solver from a plain "planning problem", and decodes the solution.
// Pure functions only — loaded by solver-worker.js and by Node tests.
//
// Problem shape (built by buildSolverProblem() in script.js):
// {
//   terms:   [{ id, order, fixedUnits, fixedDifficulty }]   // open terms, chronological
//   fixed:   { courseId: order }      // summer/locked/pinned courses already placed
//   fixedCourses: [{ id, order, prerequisites }]  // fixed courses whose prereqs must come first
//   courses: [{ id, units, difficulty, required, score, prerequisites, corequisites, categories }]
//   targets: { category: { count, units } }   // remaining room under graduation targets
//   config:  { maxUnits, targetUnits, maxDifficulty, overloadPenalty, difficultyPenalty }
// }
//
// Model: x_i_j = 1 when course i is taken in open term j.
//   each course at most once; prerequisites in an earlier term (any course of
//   an OR-group); corequisites earlier or in the same term; hard unit cap per
//   term; graduation-requirement targets not exceeded.
// Objective (maximize): placing courses (required ≫ optional), earlier is
//   better (bottleneck courses most), minus soft penalties for loads above
//   the target units and difficulty above the cap.

const SOLVER_WEIGHTS = {
    REQUIRED_REWARD: 10000,
    OPTIONAL_REWARD: 1000,
    LATENESS_BASE: 10,          // per term of delay, per course
    REQUIRED_LATENESS_FACTOR: 2, // required courses cost more to delay
    LATENESS_PER_SCORE: 0.1,    // extra delay cost per priority-score point
    UNMET_PINNED_PREREQ: 5000   // soft: a pinned course's prereq can't be scheduled in time
};

function buildPlanModel(problem) {
    const { terms, courses, fixed, config } = problem;
    const fixedCourses = problem.fixedCourses || [];
    const targets = problem.targets || {};
    const W = SOLVER_WEIGHTS;

    const courseIndex = new Map(courses.map((c, i) => [c.id, i]));
    const x = (i, j) => `x_${i}_${j}`;
    const termsBefore = (order) => terms.map((t, j) => j).filter(j => terms[j].order < order);
    const termsUpTo = (order) => terms.map((t, j) => j).filter(j => terms[j].order <= order);

    const objective = [];
    const constraints = [];
    const nonNegative = [];
    let rowId = 0;
    const addRow = (terms_, sense, rhs) => {
        if (terms_.length === 0) {
            // 0 <= rhs / 0 >= rhs: only emit when it would be violated, which
            // callers avoid; skip trivially satisfied rows.
            return;
        }
        constraints.push({ name: `r${rowId++}`, terms: terms_, sense, rhs });
    };

    // An alternative counts if it's a course in this problem or a fixed one.
    const relevant = (id) => courseIndex.has(id) || fixed[id] != null;

    courses.forEach((course, i) => {
        const reward = course.required ? W.REQUIRED_REWARD : W.OPTIONAL_REWARD;
        const lateness = (W.LATENESS_BASE + Math.max(0, course.score || 0) * W.LATENESS_PER_SCORE)
            * (course.required ? W.REQUIRED_LATENESS_FACTOR : 1);
        terms.forEach((term, j) => {
            objective.push([reward + (course.score || 0) - lateness * j, x(i, j)]);
        });

        // Each course at most once
        addRow(terms.map((t, j) => [1, x(i, j)]), '<=', 1);

        // Prerequisite entries: AND across entries, OR within an entry.
        // Cumulative ("by term j") form: taking course i by term j requires
        // some alternative strictly before term j. This is the tight
        // precedence formulation; the per-term form solves far slower.
        (course.prerequisites || []).forEach(entry => {
            const alternatives = entry.filter(relevant);
            if (alternatives.length === 0) return;
            terms.forEach((term, j) => {
                const fixedBefore = alternatives.some(a => fixed[a] != null && fixed[a] < term.order);
                if (fixedBefore) return;
                const row = termsUpTo(term.order).map(jj => [1, x(i, jj)]);
                alternatives.forEach(a => {
                    if (!courseIndex.has(a)) return;
                    const ai = courseIndex.get(a);
                    termsBefore(term.order).forEach(jj => row.push([-1, x(ai, jj)]));
                });
                addRow(row, '<=', 0);
            });
        });

        // Corequisites: earlier or the same term (same cumulative form)
        (course.corequisites || []).forEach(coreq => {
            if (!relevant(coreq)) return;
            terms.forEach((term, j) => {
                if (fixed[coreq] != null && fixed[coreq] <= term.order) return;
                const row = termsUpTo(term.order).map(jj => [1, x(i, jj)]);
                if (courseIndex.has(coreq)) {
                    const qi = courseIndex.get(coreq);
                    termsUpTo(term.order).forEach(jj => row.push([-1, x(qi, jj)]));
                }
                addRow(row, '<=', 0);
            });
        });
    });

    // Fixed (pinned/locked/summer) courses: each prerequisite entry must be
    // met before them. Soft, so an impossible pin can't make the model
    // infeasible — the pinned card just stays red.
    fixedCourses.forEach((fc, k) => {
        (fc.prerequisites || []).forEach((entry, e) => {
            const alternatives = entry.filter(relevant);
            if (alternatives.length === 0) return;
            if (alternatives.some(a => fixed[a] != null && fixed[a] < fc.order)) return;
            const slack = `s_${k}_${e}`;
            nonNegative.push(slack);
            objective.push([-W.UNMET_PINNED_PREREQ, slack]);
            const row = [[1, slack]];
            alternatives.forEach(a => {
                if (!courseIndex.has(a)) return;
                const ai = courseIndex.get(a);
                termsBefore(fc.order).forEach(jj => row.push([1, x(ai, jj)]));
            });
            addRow(row, '>=', 1);
        });
    });

    // Per-term capacity (hard) and load/difficulty targets (soft)
    terms.forEach((term, j) => {
        const unitsRow = courses.map((c, i) => [c.units || 0, x(i, j)]).filter(([u]) => u !== 0);
        addRow(unitsRow, '<=', Math.max(0, config.maxUnits - term.fixedUnits));

        const over = `over_${j}`;
        nonNegative.push(over);
        objective.push([-config.overloadPenalty, over]);
        addRow([...unitsRow, [-1, over]], '<=', config.targetUnits - term.fixedUnits);

        const diffRow = courses.map((c, i) => [c.difficulty || 0, x(i, j)]).filter(([d]) => d !== 0);
        const dover = `dover_${j}`;
        nonNegative.push(dover);
        objective.push([-config.difficultyPenalty, dover]);
        addRow([...diffRow, [-1, dover]], '<=', config.maxDifficulty - term.fixedDifficulty);
    });

    // Graduation-requirement targets: don't schedule past what's still needed
    Object.entries(targets).forEach(([category, target]) => {
        const members = courses.map((c, i) => [c, i]).filter(([c]) => (c.categories || []).includes(category));
        if (members.length === 0) return;
        if (target.count != null) {
            addRow(members.flatMap(([c, i]) => terms.map((t, j) => [1, x(i, j)])), '<=', Math.max(0, target.count));
        }
        if (target.units != null) {
            addRow(members.flatMap(([c, i]) => terms.map((t, j) => [c.units || 0, x(i, j)])), '<=', Math.max(0, target.units));
        }
    });

    const binaries = courses.flatMap((c, i) => terms.map((t, j) => x(i, j)));
    const lp = [
        'Maximize',
        ' obj: ' + formatLinear(objective),
        'Subject To',
        ...constraints.map(r => ` ${r.name}: ${formatLinear(r.terms)} ${r.sense} ${formatNumber(r.rhs)}`),
        'Bounds',
        ...nonNegative.map(v => ` ${v} >= 0`),
        'Binary',
        ...chunk(binaries, 12).map(line => ' ' + line.join(' ')),
        'End'
    ].join('\n');

    return {
        lp,
        stats: { variables: binaries.length + nonNegative.length, binaries: binaries.length, constraints: constraints.length }
    };
}

// Map solver columns back to { courseId: termId } for placed courses.
function decodePlanSolution(problem, columns) {
    const placements = {};
    problem.courses.forEach((course, i) => {
        problem.terms.forEach((term, j) => {
            const col = columns[`x_${i}_${j}`];
            if (col && col.Primal > 0.5) placements[course.id] = term.id;
        });
    });
    return placements;
}

function formatNumber(n) {
    // LP format has no exponent-free guarantee for tiny floats; round to 6 dp
    return String(Math.round(n * 1e6) / 1e6);
}

function formatLinear(terms) {
    if (terms.length === 0) return '0';
    // Wrap long expressions across lines (LP format allows continuation)
    return chunk(terms, 8).map((group, gi) => group.map(([coef, name], k) => {
        const sign = coef < 0 ? '-' : '+';
        const abs = formatNumber(Math.abs(coef));
        const first = gi === 0 && k === 0;
        return `${first ? (coef < 0 ? '- ' : '') : sign + ' '}${abs} ${name}`;
    }).join(' ')).join('\n   ');
}

function chunk(items, size) {
    const out = [];
    for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
    return out;
}

if (typeof module === 'object' && module.exports) {
    module.exports = { buildPlanModel, decodePlanSolution, SOLVER_WEIGHTS };
}
