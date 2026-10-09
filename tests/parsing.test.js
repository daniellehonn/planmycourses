const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlanner } = require('./helpers/planner');

const planner = createPlanner();
const parse = (text) => planner.value(`parseDelimited(${JSON.stringify(text)})`);

test('quoted cells keep commas, escaped quotes, and line breaks', () => {
    const rows = parse('Course Number,Description\n"CS 1","Intro, ""fun""\nsecond line"\nCS 2,x\n');
    assert.equal(rows.length, 2);
    assert.equal(rows[0].Description, 'Intro, "fun"\nsecond line');
    assert.equal(rows[1]['Course Number'], 'CS 2');
});

test('blank and all-empty trailing rows are skipped', () => {
    const rows = parse('Course Number,Units\r\nCS 1,4\r\n,,\r\n\r\n');
    assert.deepEqual(rows, [{ 'Course Number': 'CS 1', Units: '4' }]);
});

test('tab-separated input and a byte-order mark are handled', () => {
    const rows = parse('﻿Course Number\tUnits\nCS 1\t4');
    assert.deepEqual(rows, [{ 'Course Number': 'CS 1', Units: '4' }]);
});

test('prerequisites: commas mean all, "/" means either', () => {
    assert.deepEqual(planner.value(`parsePrerequisites('CS 31 /CS 31E,  MATH 31A')`), ['CS 31 / CS 31E', 'MATH 31A']);
    assert.deepEqual(planner.value(`parsePrerequisites('None')`), []);
    assert.equal(planner.run(`isPrereqEntryMet('A / B', new Set(['B']), () => true)`), true);
    assert.equal(planner.run(`isPrereqEntryMet('A / B', new Set(), () => true)`), false);
});

test('categories split on commas', () => {
    assert.deepEqual(planner.value(`getCourseCategories({ reqSatisfied: 'ST, Stats & DS Minor' })`), ['ST', 'Stats & DS Minor']);
});
