// One test per bug fixed in the Oct 2026 review, so they stay fixed.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanner } = require('./helpers/planner');
const { checkPlan } = require('./helpers/invariants');
const { toCsv } = require('./helpers/catalogs');
const { SAMPLE } = require('./fixtures');

const row = (id, opts = {}) => ({
    id, category: opts.category || 'Major Core', units: opts.units ?? 4,
    prerequisites: opts.prereqs || [], corequisites: opts.coreqs || [],
    description: opts.description || id, taken: opts.taken || ''
});

const termOf = (snapshot, id) => {
    const t = snapshot.terms.find(t => t.classes.includes(id));
    return t ? t.id : 'unassigned';
};
const orderOf = (snapshot, id) => {
    const t = snapshot.terms.find(t => t.classes.includes(id));
    return t ? t.order : Infinity;
};

for (const engine of ['heuristic', 'optimal']) {
    const runPlan = (planner) => engine === 'optimal' ? planner.runOptimal() : planner.runHeuristic();

    test(`${engine}: a summer course only counts for later terms`, async () => {
        const csv = toCsv([
            row('B 1', { taken: 'Summer, Year 3' }),
            row('B 2', { prereqs: ['B 1'] })
        ]);
        const planner = await createPlanner({ terms: 16 }).load(csv);
        await runPlan(planner);
        const s = planner.snapshot();
        assert.ok(orderOf(s, 'B 2') > orderOf(s, 'B 1'), `B 2 landed in ${termOf(s, 'B 2')}`);
    });

    test(`${engine}: prerequisites of a pinned course land before it`, async () => {
        const csv = toCsv([
            row('P 1'), row('P 2', { prereqs: ['P 1'] }),
            row('P 3', { prereqs: ['P 2'], taken: 'Spring, Year 1' })
        ]);
        const planner = await createPlanner({ terms: 8 }).load(csv);
        await runPlan(planner);
        const s = planner.snapshot();
        assert.ok(orderOf(s, 'P 1') < orderOf(s, 'P 2'));
        assert.ok(orderOf(s, 'P 2') < orderOf(s, 'P 3'), `P 2 in ${termOf(s, 'P 2')}`);
    });

    test(`${engine}: a pinned course satisfies its corequisite partner`, async () => {
        const csv = toCsv([
            row('L 1', { coreqs: ['L 1L'], taken: 'Winter, Year 1' }),
            row('L 1L', { units: 1, coreqs: ['L 1'] })
        ]);
        const planner = await createPlanner({ terms: 8 }).load(csv);
        planner.run(`lockedQuarters.delete('winter1')`); // open the term so L 1L can join it
        await runPlan(planner);
        const s = planner.snapshot();
        assert.ok(orderOf(s, 'L 1L') <= orderOf(s, 'L 1'), `L 1L in ${termOf(s, 'L 1L')}`);
    });

    test(`${engine}: "/" means either course`, async () => {
        // O 1H can never be scheduled (its prerequisite is too big for any
        // term), so O 2 can only be placed if O 1 alone satisfies "O 1 / O 1H".
        const csv = toCsv([
            row('O 1', { taken: 'Fall, Year 1' }),
            row('O 9', { units: 99 }), row('O 1H', { prereqs: ['O 9'] }),
            row('O 2', { prereqs: ['O 1 / O 1H'] })
        ]);
        const planner = await createPlanner({ terms: 8, maxUnits: 12 }).load(csv);
        await runPlan(planner);
        const s = planner.snapshot();
        assert.equal(termOf(s, 'O 1H'), 'unassigned');
        assert.ok(orderOf(s, 'O 2') > orderOf(s, 'O 1') && orderOf(s, 'O 2') < Infinity, `O 2 in ${termOf(s, 'O 2')}`);
    });

    test(`${engine}: Taken terms are locked and left alone`, async () => {
        const planner = await createPlanner({ terms: 12 }).load(SAMPLE);
        const before = planner.snapshot();
        assert.deepEqual(before.terms.filter(t => t.locked).map(t => t.id), ['fall1', 'winter1', 'spring1', 'summer2']);
        await runPlan(planner);
        assert.deepEqual(checkPlan(before, planner.snapshot()), []);
    });
}

test('a Taken term outside the timeline leaves the course unassigned', async () => {
    const csv = toCsv([row('X 1', { taken: 'Fall, Year 5' })]);
    const planner = await createPlanner({ terms: 12 }).load(csv);
    const s = planner.snapshot();
    assert.deepEqual(s.unassigned, ['X 1']);
    assert.equal(planner.run('pinnedCourses.has("X 1")'), false);
});

test('loading a new list clears old pins and locks', async () => {
    const planner = await createPlanner({ terms: 12 }).load(SAMPLE);
    await planner.load(toCsv([row('N 1')]));
    assert.equal(planner.run('pinnedCourses.size'), 0);
    assert.equal(planner.run('lockedQuarters.size'), 0);
});

test('changing the timeline keeps placements in terms that still exist', async () => {
    const planner = await createPlanner({ terms: 12 }).load(SAMPLE);
    planner.runHeuristic();
    const before = planner.snapshot();
    planner.run(`document.getElementById('quartersToGraduateNew').value = '16'; updateDynamicSettings();`);
    const after = planner.snapshot();
    before.terms.forEach(t => {
        assert.deepEqual(after.terms.find(x => x.id === t.id).classes, t.classes, t.id);
    });
    assert.equal(after.terms.length, 16);
});

test('moving a pinned course moves its pin', async () => {
    const planner = await createPlanner({ terms: 12 }).load(SAMPLE);
    planner.run(`lockedQuarters.delete('fall1')`);
    planner.run(`moveCourse('CS 31', 'winter2')`);
    planner.runHeuristic();
    const s = planner.snapshot();
    assert.equal(termOf(s, 'CS 31'), 'winter2');
    assert.equal(s.terms.filter(t => t.classes.includes('CS 31')).length, 1);
});

test('moves into or out of a locked term are refused', async () => {
    const planner = await createPlanner({ terms: 12 }).load(SAMPLE);
    const result = planner.run(`moveCourse('CS 31', 'winter2')`); // CS 31 sits in locked fall1
    assert.equal(result.moved, false);
    assert.equal(termOf(planner.snapshot(), 'CS 31'), 'fall1');
});

test('unlocking a term keeps the Taken pins', async () => {
    const planner = await createPlanner({ terms: 12 }).load(SAMPLE);
    planner.run(`unlockQuarter('fall1')`);
    const fall1 = planner.snapshot().terms.find(t => t.id === 'fall1');
    assert.equal(fall1.locked, false);
    assert.deepEqual([...fall1.pinned].sort(), [...fall1.classes].sort());
});

test('automatic max units never drops below the largest course', async () => {
    const csv = toCsv([row('U 1', { units: 5 }), row('U 2', { units: 5 }), row('U 3', { units: 1 })]);
    const planner = await createPlanner({ terms: 12 }).load(csv);
    assert.ok(planner.snapshot().maxUnits >= 12);
});

test('Fastest mode uses the raised cap for drag checks', async () => {
    const planner = await createPlanner({ terms: 12, speed: 'fastest', maxUnits: 16 }).load(toCsv([
        row('F 1', { units: 5 }), row('F 2', { units: 5 }), row('F 3', { units: 5 }), row('F 4', { units: 4 })
    ]));
    ['F 1', 'F 2', 'F 3'].forEach(id => planner.run(`moveCourse('${id}', 'fall1')`));
    const check = planner.run(`validateCoursePlacement('F 4', 'fall1')`);
    assert.equal(check.isValid, true, check.reason); // 19 units <= 16 + 4
});

test('export round-trips commas, quotes, and course ids', async () => {
    const csv = toCsv([
        row('R 1', { description: 'Intro, part "1"' }),
        row('R 2', { prereqs: ['R 1'], description: 'Second\nline' })
    ]);
    const planner = await createPlanner({ terms: 8 }).load(csv);
    planner.run(`findClassById('R 1').name = 'Renamed'; downloadPlan();`);
    const reloaded = planner.run(`parseDelimited(${JSON.stringify(planner.exported.csv)})`);
    assert.equal(reloaded[0]['Course Number'], 'R 1');
    assert.equal(reloaded[0].Description, 'Intro, part "1"');
    assert.equal(reloaded[1].Prerequisites, 'R 1');
    assert.equal(reloaded[1].Description, 'Second\nline');
});

test('course text is escaped before it reaches HTML', async () => {
    const planner = await createPlanner({ terms: 8 }).load(toCsv([row('H 1')]));
    assert.equal(planner.run(`escapeHtml('<img src=x onerror=alert(1)>')`),
        '&lt;img src=x onerror=alert(1)&gt;');
});

test('export then import restores the plan and locks only Taken terms', async () => {
    const original = await createPlanner({ terms: 12 }).load(SAMPLE);
    original.runHeuristic();
    original.run('downloadPlan()');
    const planned = original.snapshot();

    const reloaded = await createPlanner({ terms: 12 }).load(original.exported.csv);
    const restored = reloaded.snapshot();

    planned.terms.forEach(t => {
        const now = restored.terms.find(x => x.id === t.id);
        assert.deepEqual([...now.classes].sort(), [...t.classes].sort(), t.id);
    });
    assert.deepEqual(restored.terms.filter(t => t.locked).map(t => t.id),
        planned.terms.filter(t => t.locked).map(t => t.id));
    // Planned courses aren't pinned, so Auto Plan is still free to move them
    assert.equal(reloaded.run('pinnedCourses.size'), original.run('pinnedCourses.size'));
});

test('automatic max units spreads what is left over the open terms', async () => {
    const planner = await createPlanner({ terms: 16 }).load(SAMPLE);
    const s = planner.snapshot();
    const open = s.terms.filter(t => !t.locked && !t.summer);
    const closedUnits = s.terms.filter(t => t.locked || t.summer).reduce((sum, t) => sum + t.units, 0);
    const totalUnits = s.courses.reduce((sum, c) => sum + c.units, 0);
    assert.ok(s.maxUnits * open.length >= totalUnits - closedUnits,
        `${open.length} open terms × ${s.maxUnits} < ${totalUnits - closedUnits} units to plan`);
    assert.ok(s.targetUnits <= s.maxUnits);
});

test('the default 4-year plan fits every course of the sample', async () => {
    const planner = await createPlanner({}).load(SAMPLE);
    await planner.runOptimal({ timeLimitSeconds: 10 });
    assert.deepEqual(planner.snapshot().unassigned, []);
});

test('courses in locked (taken) terms do not hold back their prerequisites', async () => {
    // In semester mode the sample's Winter-term courses (e.g. CS 32) have no
    // matching term, so they must be planned even though later courses that
    // need them (CS 33, Spring Y1) are already locked in.
    const planner = await createPlanner({ system: 'semester', terms: 8 }).load(SAMPLE);
    planner.runHeuristic();
    const s = planner.snapshot();
    const requiredLeft = s.courses.filter(c => c.required && s.unassigned.includes(c.id));
    assert.deepEqual(requiredLeft.map(c => c.id), []);
});

test('changing the timeline after planning says the plan is out of date', async () => {
    const planner = await createPlanner({ terms: 12 }).load(SAMPLE);
    planner.run('autoPlanCoreCourses()'); // no Worker in Node, so this runs the quick planner
    planner.run(`document.getElementById('quartersToGraduateNew').value = '16'; updateDynamicSettings();`);
    const status = planner.status();
    assert.equal(status.kind, 'warning');
    assert.match(status.text, /out of date/);
    assert.ok(status.actions.some(a => a.textContent === 'Re-plan now'));
});

test('the quick planner places a course whenever a term has room for it', async () => {
    const planner = await createPlanner({}).load(SAMPLE);
    planner.runHeuristic();
    assert.deepEqual(planner.snapshot().unassigned, []);
});

// From a user's share link: "Stats & DS Minor" target 0 blocked every course
// that also counted toward ST or Probability, so ST stayed at 0/3, Year 4
// stayed empty, and "7 courses didn't fit".
for (const engine of ['heuristic', 'optimal']) {
    test(`${engine}: a met target doesn't block courses another requirement needs`, async () => {
        const planner = await createPlanner({ terms: 16 }).load(SAMPLE);
        planner.setTargets({
            'Grad Level': { count: 0 }, '5 Elective': { count: 5 }, 'Stats & DS Minor': { count: 0 },
            'Probability': { count: 1 }, 'Capstone': { count: 1 }, 'TB': { count: 3 }, 'ST': { count: 3 },
            'GE': { count: 5 }, 'Major Core': { count: 7 }, 'Lower Div': { count: 15 }
        });
        const before = planner.snapshot();
        if (engine === 'optimal') await planner.runOptimal({ timeLimitSeconds: 10 }); else planner.runHeuristic();
        const after = planner.snapshot();
        assert.deepEqual(checkPlan(before, after), []);
        const met = planner.value(`Object.fromEntries(Object.entries(requirementTargets).map(([k, t]) => [k,
            ALL_CLASSES_DATA.filter(c => getCourseCategories(c).includes(k) &&
                quartersData.some(q => q.id !== 'unassigned' && q.classes.includes(c.id))).length >= t.count]))`);
        assert.deepEqual(Object.entries(met).filter(([, ok]) => !ok).map(([k]) => k), []);
        assert.ok(after.unassigned.every(id => after.courses.find(c => c.id === id).reason.startsWith('Not needed')),
            'everything left out is only left out because its requirement is met');
    });
}

test('unused template rows (no course number) are skipped, not rejected', async () => {
    // The Google Sheets template pre-fills Taken and Difficulty on blank rows
    const csv = 'Taken,Course Number,Prerequisites,Corequisites,Description,Units,Difficulty\n' +
        'Not Assigned,CS 1,None,None,Intro,1,1\n' +
        'Not Assigned,,,,,,1\n'.repeat(18);
    const planner = await createPlanner().load(csv);
    assert.deepEqual(planner.snapshot().courses.map(c => c.id), ['CS 1']);
});
