// Inputs both planners are run on. Each fixture is a course list plus the
// settings a student would pick in the toolbar.
const fs = require('fs');
const path = require('path');
const { generateCatalog, toCsv } = require('./helpers/catalogs');

const SAMPLE = fs.readFileSync(
    path.join(__dirname, '..', 'DANIELLEHON-FINAL_ Interactive Course Planner - Course List (1).csv'), 'utf8');

// Hand-written edge cases: OR-groups, a corequisite pair, and a chain that
// only just fits the timeline.
const EDGE_CASES = toCsv([
    { id: 'A 1', category: 'Lower Div', units: 4, prerequisites: [], corequisites: [], description: 'Intro' },
    { id: 'A 1H', category: 'Lower Div', units: 4, prerequisites: [], corequisites: [], description: 'Intro (honors)' },
    { id: 'A 2', category: 'Lower Div', units: 4, prerequisites: ['A 1 / A 1H'], corequisites: [], description: 'Either intro' },
    { id: 'A 3', category: 'Major Core', units: 4, prerequisites: ['A 2'], corequisites: ['A 3L'], description: 'Lecture' },
    { id: 'A 3L', category: 'Major Core', units: 1, prerequisites: ['A 2'], corequisites: ['A 3'], description: 'Lab' },
    { id: 'A 4', category: 'Major Core', units: 4, prerequisites: ['A 3', 'A 3L'], corequisites: [], description: 'Advanced' },
    { id: 'A 5', category: 'Major Core', units: 4, prerequisites: ['A 4'], corequisites: [], description: 'Capstone prep' },
    { id: 'A 6', category: 'Capstone', units: 4, prerequisites: ['A 5'], corequisites: [], description: 'Capstone' },
    { id: 'E 1', category: '5 Elective', units: 4, prerequisites: ['A 1 / A 1H'], corequisites: [], description: 'Elective' },
    { id: 'E 2', category: '5 Elective', units: 4, prerequisites: [], corequisites: [], description: 'Elective' },
    { id: 'G 1', category: 'GE', units: 5, prerequisites: [], corequisites: [], description: 'General ed' },
    { id: 'G 2', category: 'GE', units: 5, prerequisites: [], corequisites: [], description: 'General ed' }
]);

const FIXTURES = [
    { name: 'sample · 3 years', csv: SAMPLE, options: { system: 'quarter', terms: 12 } },
    { name: 'sample · 4 years', csv: SAMPLE, options: { system: 'quarter', terms: 16 } },
    { name: 'sample · 4 years · fastest', csv: SAMPLE, options: { system: 'quarter', terms: 16, speed: 'fastest' } },
    { name: 'sample · 3 years · max 16', csv: SAMPLE, options: { system: 'quarter', terms: 12, maxUnits: 16 } },
    { name: 'generated · 30 courses · semesters', csv: generateCatalog({ seed: 1, count: 30, levels: 4, takenUnits: 8 }),
        options: { system: 'semester', terms: 8 } },
    { name: 'generated · 45 courses', csv: generateCatalog({ seed: 2, count: 45, levels: 6, takenUnits: 12 }),
        options: { system: 'quarter', terms: 16 } },
    // Stress case: ~230 units of courses for 144 units of capacity, so the
    // solver must choose which optional courses to drop. Proving optimality
    // can take longer than the app's time limit; the best plan found is used.
    { name: 'generated · 60 courses · over capacity', csv: generateCatalog({ seed: 3, count: 60, levels: 6, coreqPairs: 2 }),
        options: { system: 'quarter', terms: 12, maxUnits: 16 }, stress: true },
    { name: 'generated · deep chains', csv: generateCatalog({ seed: 4, count: 36, levels: 9, requiredShare: 0.7 }),
        options: { system: 'quarter', terms: 12 } },
    { name: 'generated · elective targets', csv: generateCatalog({ seed: 5, count: 40, levels: 5, requiredShare: 0.4 }),
        options: { system: 'quarter', terms: 16 }, targets: { '5 Elective': { count: 3 }, 'GE': { count: 2 }, 'TB': { units: 8 } } },
    { name: 'edge cases · chain fills 2 years', csv: EDGE_CASES, options: { system: 'quarter', terms: 8, maxUnits: 12 } }
];

module.exports = { FIXTURES, SAMPLE, EDGE_CASES };
