// Rules every plan must satisfy, checked on snapshots taken before and after
// a planner runs. Only courses the planner itself placed are held to the
// prerequisite rules — pinned/Taken placements come from the user and may be
// inconsistent on purpose.

function alternatives(entry) {
    return entry.split('/').map(s => s.trim()).filter(Boolean);
}

function placementMap(snapshot) {
    const map = {};
    snapshot.terms.forEach(t => t.classes.forEach(id => { map[id] = t; }));
    return map;
}

function checkPlan(before, after) {
    const violations = [];
    const courseIds = new Set(after.courses.map(c => c.id));
    const courses = Object.fromEntries(after.courses.map(c => [c.id, c]));
    const placedBefore = placementMap(before);
    const placedAfter = placementMap(after);

    // 1. Every enabled course appears exactly once (a term or Unassigned)
    const seen = {};
    after.terms.forEach(t => t.classes.forEach(id => { seen[id] = (seen[id] || 0) + 1; }));
    after.unassigned.forEach(id => { seen[id] = (seen[id] || 0) + 1; });
    courseIds.forEach(id => {
        if (seen[id] !== 1) violations.push(`${id} appears ${seen[id] || 0} times`);
    });

    const plannerPlaced = Object.keys(placedAfter).filter(id => !placedBefore[id]);

    plannerPlaced.forEach(id => {
        const term = placedAfter[id];
        const course = courses[id];
        // 2. Prerequisites: some course of each entry in an earlier term
        course.prerequisites.forEach(entry => {
            const relevant = alternatives(entry).filter(a => courseIds.has(a));
            if (relevant.length === 0) return;
            const met = relevant.some(a => placedAfter[a] && placedAfter[a].order < term.order);
            if (!met) violations.push(`${id} (${term.id}) before prerequisite ${entry}`);
        });
        // 3. Corequisites: earlier or the same term
        course.corequisites.forEach(coreq => {
            if (!courseIds.has(coreq)) return;
            const q = placedAfter[coreq];
            if (!q || q.order > term.order) violations.push(`${id} (${term.id}) without corequisite ${coreq}`);
        });
        // 4. Planners never schedule into summer or locked terms
        if (term.summer) violations.push(`${id} planned into summer term ${term.id}`);
        if (term.locked) violations.push(`${id} planned into locked term ${term.id}`);
    });

    // 5. Unit cap holds for every term the planner added to
    after.terms.forEach(t => {
        const added = t.classes.filter(id => !placedBefore[id]);
        if (added.length > 0 && t.units > after.maxUnits) {
            violations.push(`${t.id} has ${t.units} units (max ${after.maxUnits})`);
        }
    });

    // 6. Locked terms and pinned courses are untouched
    before.terms.forEach(t => {
        const now = after.terms.find(x => x.id === t.id);
        if (t.locked && JSON.stringify([...t.classes].sort()) !== JSON.stringify([...now.classes].sort())) {
            violations.push(`locked term ${t.id} changed`);
        }
        t.pinned.forEach(id => {
            if (!now.classes.includes(id)) violations.push(`pinned ${id} moved out of ${t.id}`);
        });
    });

    // 7. Graduation targets: every course the planner added is still needed.
    //    It has a category without a target, or a category still at or below
    //    its target, or a placed course that needs it as a prerequisite.
    //    (A course may push a met category over target when it also counts
    //    toward an unmet one, e.g. "ST, Stats & DS Minor".)
    const targets = after.targets || {};
    const hasTarget = k => targets[k] && (targets[k].count != null || targets[k].units != null);
    const counts = {};
    const unitTotals = {};
    Object.keys(placedAfter).forEach(id => (courses[id] ? courses[id].categories : []).forEach(k => {
        counts[k] = (counts[k] || 0) + 1;
        unitTotals[k] = (unitTotals[k] || 0) + courses[id].units;
    }));
    plannerPlaced.forEach(id => {
        const course = courses[id];
        if (!course.categories.every(hasTarget)) return;
        const isPrereq = Object.keys(placedAfter).some(other =>
            courses[other] && courses[other].prerequisites.some(entry => alternatives(entry).includes(id)));
        if (isPrereq) return;
        const withinSome = course.categories.some(k => {
            const t = targets[k];
            const countOk = t.count == null || counts[k] - 1 < t.count;
            const unitsOk = t.units == null || unitTotals[k] - course.units < t.units;
            return countOk && unitsOk;
        });
        if (!withinSome) violations.push(`${id} planned although ${course.categories.join(', ')} already met`);
    });

    return violations;
}

// Numbers used to compare planners on the same input
function planMetrics(after) {
    const courses = Object.fromEntries(after.courses.map(c => [c.id, c]));
    const notNeeded = after.courses.filter(c => after.unassigned.includes(c.id) && c.reason.startsWith('Not needed'));
    const unplaced = after.unassigned.filter(id => !notNeeded.some(c => c.id === id));
    const academic = after.terms.filter(t => !t.summer);
    let last = academic.length - 1;
    while (last > 0 && academic[last].classes.length === 0) last--;
    const loads = academic.slice(0, last + 1).map(t => t.units);
    const mean = loads.reduce((a, b) => a + b, 0) / Math.max(1, loads.length);
    const stdev = Math.sqrt(loads.reduce((s, l) => s + (l - mean) ** 2, 0) / Math.max(1, loads.length));
    return {
        placed: after.courses.length - after.unassigned.length,
        total: after.courses.length,
        unplaced: unplaced.length,
        requiredUnplaced: unplaced.filter(id => courses[id].required).length,
        finishTerm: academic[last] ? academic[last].name : '-',
        termsUsed: last + 1,
        maxLoad: loads.length ? Math.max(...loads) : 0,
        loadStdev: Math.round(stdev * 100) / 100
    };
}

module.exports = { checkPlan, planMetrics };
