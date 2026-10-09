// Loads the real script.js (a browser script) into a Node VM with a minimal
// fake DOM, so tests drive the exact code the app runs. Both planners are
// available: the heuristic runs as-is; the optimal planner runs HiGHS in
// Node instead of a Web Worker, through the same buildSolverProblem /
// applySolverPlacements functions the browser uses.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = fs.readFileSync(path.join(ROOT, 'script.js'), 'utf8');
const solver = require(path.join(ROOT, 'solver.js'));

let highsPromise = null;
function loadHighs() {
    if (!highsPromise) highsPromise = require('highs')();
    return highsPromise;
}

function fakeElement() {
    const classes = new Set();
    return {
        style: { setProperty() {} },
        classList: {
            add: (...c) => c.forEach(x => classes.add(x)),
            remove: (...c) => c.forEach(x => classes.delete(x)),
            contains: c => classes.has(c),
            toggle: (c, force) => {
                const on = force === undefined ? !classes.has(c) : force;
                if (on) classes.add(c); else classes.delete(c);
                return on;
            }
        },
        dataset: {},
        children: [],
        options: [],
        value: '',
        hidden: false,
        disabled: false,
        download: '',
        innerHTML: '',
        textContent: '',
        appendChild(child) { this.children.push(child); return child; },
        append(...nodes) { this.children.push(...nodes); },
        removeChild() {},
        remove() {},
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        closest() { return null; },
        querySelector() { return null; },
        querySelectorAll() { return []; },
        getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; },
        focus() {},
        click() {}
    };
}

// options: { system: 'quarter'|'semester', terms, speed: 'balanced'|'fastest', maxUnits }
function createPlanner(options = {}) {
    const { system = 'quarter', terms = 16, speed = 'balanced', maxUnits = null } = options;
    const elements = {};
    const getElementById = (id) => elements[id] || (elements[id] = fakeElement());
    getElementById('quartersToGraduateNew').value = String(terms);
    getElementById('academicSystemNew').value = system;

    const storage = {};
    const exported = { csv: null };
    const context = {
        document: {
            getElementById,
            createElement: () => fakeElement(),
            querySelector: () => null,
            querySelectorAll: () => [],
            addEventListener() {},
            removeEventListener() {},
            body: fakeElement()
        },
        window: {},
        console: { log() {}, warn() {}, error() {} },
        localStorage: {
            getItem: k => (k in storage ? storage[k] : null),
            setItem: (k, v) => { storage[k] = String(v); },
            removeItem: k => { delete storage[k]; }
        },
        CSS: { escape: s => s },
        Blob: function (parts) { exported.csv = parts.join(''); },
        URL: { createObjectURL: () => 'blob:test', revokeObjectURL() {} },
        setTimeout: () => 0,
        clearTimeout() {},
        performance,
        alert() { throw new Error('alert() should not be called'); }
    };
    vm.createContext(context);
    vm.runInContext(SCRIPT, context, { filename: 'script.js' });

    const run = (code) => vm.runInContext(code, context);
    run(`currentAcademicSystem = ${JSON.stringify(system)};
         dynamicSettings.useCustomQuarters = false;
         dynamicSettings.quartersToGraduate = ${Number(terms)};
         planningSpeed = ${JSON.stringify(speed)};`);

    const api = {
        run,
        context,
        exported,

        // Evaluate an expression and return it as plain Node data (objects
        // from the VM have their own prototypes, which deepEqual rejects)
        value(code) {
            return JSON.parse(run(`JSON.stringify(${code})`));
        },

        async load(csvText) {
            context.__csv = csvText;
            await run('processTSVData(__csv)');
            if (maxUnits != null) {
                run(`PLANNING_CONFIG.MAX_UNITS_PER_QUARTER = ${Number(maxUnits)};
                     PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER = true;`);
            }
            return api;
        },

        setTargets(targets) {
            context.__targets = targets;
            run('requirementTargets = JSON.parse(JSON.stringify(__targets))');
        },

        runHeuristic() {
            const start = performance.now();
            run('autoPlanHeuristic()');
            return { engine: 'heuristic', ms: performance.now() - start, status: 'n/a' };
        },

        async runOptimal({ timeLimitSeconds = 20 } = {}) {
            const highs = await loadHighs();
            const start = performance.now();
            const run_ = run('preparePlanningRun()');
            context.__run = run_;
            const problem = run('buildSolverProblem(__run)');
            let status = 'Nothing to place';
            let stats = null;
            let keptHeuristic = false;
            if (problem.courses.length > 0) {
                const model = solver.buildPlanModel(problem);
                stats = model.stats;
                const result = highs.solve(model.lp, { output_flag: false, time_limit: timeLimitSeconds, mip_rel_gap: 0 });
                status = result.Status;
                if (!result.Columns) throw new Error(`Solver returned no solution (${status})`);
                context.__problem = problem;
                context.__placements = solver.decodePlanSolution(problem, result.Columns);
                context.__status = status;
                // Same rule as the app: an unproven solver plan is compared
                // with the quick planner's and the better one kept
                const settled = run('settleOptimalRun(__run, __problem, __placements, __status)');
                keptHeuristic = settled.keptHeuristic;
                context.__run = settled.run;
            }
            run('finishPlanningRun(__run)');
            return { engine: 'optimal', ms: performance.now() - start, status, stats, keptHeuristic };
        },

        // Plain-data view of the current plan
        snapshot() {
            return JSON.parse(run(`JSON.stringify((() => {
                const terms = quartersData
                    .filter(q => q.id !== 'unassigned')
                    .sort((a, b) => getQuarterChronologicalOrder(a) - getQuarterChronologicalOrder(b))
                    .map(q => ({
                        id: q.id, name: q.name, order: getQuarterChronologicalOrder(q),
                        summer: q.name.toLowerCase().includes('summer'),
                        locked: isQuarterLocked(q.id),
                        classes: [...q.classes],
                        pinned: [...(q.pinnedClasses || [])],
                        units: q.classes.reduce((s, id) => s + (findClassById(id)?.units || 0), 0)
                    }));
                const courses = ALL_CLASSES_DATA.filter(c => c.enabled !== false).map(c => ({
                    id: c.id, units: c.units, prerequisites: c.prerequisites, corequisites: c.corequisites,
                    categories: getCourseCategories(c),
                    required: getCourseCategories(c).some(cat => REQUIRED_CATEGORIES.has(cat)),
                    reason: (graph[c.id] && graph[c.id].unassignedReason) || ''
                }));
                return {
                    terms,
                    unassigned: [...(getQuarterById('unassigned')?.classes || [])],
                    courses,
                    maxUnits: getEffectiveMaxUnitsPerQuarter(),
                    targetUnits: PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER,
                    targets: requirementTargets
                };
            })())`));
        }
    };
    return api;
}

module.exports = { createPlanner, loadHighs, ROOT };
