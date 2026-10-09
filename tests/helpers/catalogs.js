// Deterministic synthetic course catalogs (CSV text in the app's format), so
// the planners can be compared on inputs other than the one sample sheet.

// mulberry32: small seeded PRNG so every run generates the same catalog
function rng(seed) {
    let a = seed >>> 0;
    return () => {
        a = (a + 0x6D2B79F5) >>> 0;
        let t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const csvField = v => `"${String(v).replace(/"/g, '""')}"`;

function toCsv(rows) {
    const header = 'Taken,Req Satisfied,Course Number,Prerequisites,Corequisites,Description,Units';
    return [header, ...rows.map(r => [
        r.taken || 'Not Assigned', r.category, r.id,
        r.prerequisites.length ? r.prerequisites.join(', ') : 'None',
        r.corequisites.length ? r.corequisites.join(', ') : 'None',
        r.description, r.units
    ].map(csvField).join(','))].join('\n');
}

// options:
//   seed, count            — catalog size
//   levels                 — prerequisite depth (longest possible chain)
//   requiredShare          — fraction of courses that are required
//   orShare                — chance a prerequisite entry is an OR-group
//   coreqPairs             — number of mutual corequisite pairs
//   takenUnits             — units of level-0 courses marked Taken in Fall, Year 1
function generateCatalog(options) {
    const {
        seed = 1, count = 40, levels = 5, requiredShare = 0.55,
        orShare = 0.15, coreqPairs = 1, takenUnits = 0
    } = options;
    const rand = rng(seed);
    const pick = arr => arr[Math.floor(rand() * arr.length)];
    const optionalCategories = ['5 Elective', 'GE', 'TB'];

    const rows = [];
    for (let i = 0; i < count; i++) {
        const level = Math.min(levels - 1, Math.floor((i / count) * levels));
        const required = rand() < requiredShare;
        const category = required ? (level <= 1 ? 'Lower Div' : 'Major Core') : pick(optionalCategories);
        const unitsRoll = rand();
        const units = unitsRoll < 0.1 ? 2 : unitsRoll < 0.2 ? 5 : 4;
        rows.push({ id: `C ${100 + i}`, level, category, units, prerequisites: [], corequisites: [],
            description: `Course ${100 + i} (level ${level})`, taken: '' });
    }

    // Prerequisites come from lower levels, so the graph is acyclic
    rows.forEach(row => {
        if (row.level === 0) return;
        const prev = rows.filter(r => r.level === row.level - 1);
        const lower = rows.filter(r => r.level < row.level);
        const n = 1 + (rand() < 0.4 ? 1 : 0);
        const chosen = new Set();
        for (let k = 0; k < n; k++) {
            const pool = k === 0 ? prev : lower;
            if (rand() < orShare && pool.length >= 2) {
                const a = pick(pool), b = pick(pool.filter(r => r !== a));
                const entry = `${a.id} / ${b.id}`;
                if (!chosen.has(entry)) { chosen.add(entry); row.prerequisites.push(entry); }
            } else {
                const p = pick(pool);
                if (!chosen.has(p.id)) { chosen.add(p.id); row.prerequisites.push(p.id); }
            }
        }
    });

    // Mutual corequisite pairs between unrelated courses on the same level
    for (let k = 0; k < coreqPairs; k++) {
        const level = 1 + Math.floor(rand() * Math.max(1, levels - 1));
        const same = rows.filter(r => r.level === level && r.corequisites.length === 0);
        if (same.length < 2) continue;
        const a = pick(same), b = pick(same.filter(r => r !== a));
        a.corequisites.push(b.id);
        b.corequisites.push(a.id);
    }

    // A few completed first-term courses
    let taken = 0;
    rows.filter(r => r.level === 0 && r.corequisites.length === 0).forEach(r => {
        if (taken + r.units <= takenUnits) { r.taken = 'Fall, Year 1'; taken += r.units; }
    });

    return toCsv(rows);
}

module.exports = { generateCatalog, toCsv };
