let ALL_CLASSES_DATA = [];
let quartersData = [];
let draggedClassId = null;
let graph = {};
let pinnedCourses = new Set(); // Track which courses are pinned
let lockedQuarters = new Set(); // Track which quarters are locked
let currentAcademicSystem = 'quarter'; // 'quarter' or 'semester'

// Dynamic settings based on graduation timeline
let dynamicSettings = {
    quartersToGraduate: 16,
    useCustomQuarters: false,
    customQuarters: 16
};

// Configuration constants for course planning optimization
const PLANNING_CONFIG = {
    MAX_UNITS_PER_QUARTER: 16,
    MIN_UNITS_PER_QUARTER: 12,
    TARGET_UNITS_PER_QUARTER: 13,
    // Track which settings are overridden by user
    overrides: {
        MAX_UNITS_PER_QUARTER: false,
        MIN_UNITS_PER_QUARTER: false,
        TARGET_UNITS_PER_QUARTER: false
    }
};

// Category priority for planning sort: lower index = scheduled earlier.
// Populated from data on load; user-reorderable via settings modal.
let categoryPriority = [];
let draggedCategoryItem = null;

const DEFAULT_CATEGORY_PRIORITY = [
    'Major Core',
    'Capstone',
    'Lower Div',
    'External',
    '5 Elective',
    'TB',
    'GE',
    'Probability',
    'Stats & DS Minor',
    'ST',
    'Grad Level'
];

// Numeric requirement weights indexed by user-controlled category rank.
// Position 0 (highest priority) gets the largest weight. The values follow
// the spec (Major Core=40, Capstone=35, ...) when categories are in default
// order; drag-reorder reassigns the values to whatever's at each rank.
const DEFAULT_REQUIREMENT_WEIGHTS_BY_RANK = [40, 35, 30, 28, 24, 20, 18, 12, 8, 5];

// Categories that count as "required" for unlock counting. Everything else
// (electives, GE, TB, minor, grad) counts as elective.
const REQUIRED_CATEGORIES = new Set([
    'Major Core', 'Capstone', 'Lower Div', 'External'
]);

// Workload configuration for combination scoring
const WORKLOAD_CONFIG = {
    MAX_DIFFICULTY_PER_QUARTER: 14,
    OVERLOAD_PENALTY_PER_UNIT: 10,
    BALANCED_BONUS: 10,
    ALL_TECHNICAL_PENALTY: 20,
    // Per required course in a combination. Large enough that any eligible
    // required course outranks every optional one, so optional courses only
    // use capacity that required courses can't.
    REQUIRED_COURSE_BONUS: 1000,
    // Per course of any kind. Larger than the most one course can add in
    // workload penalties, so a course that fits is always placed rather
    // than left out to keep a term lighter.
    PLACEMENT_BONUS: 100
};

// Planning speed: 'balanced' (default) spreads workload evenly; 'fastest'
// packs more units per quarter to graduate sooner by raising the unit cap
// and softening the overload/all-technical penalties below.
let planningSpeed = 'balanced';

const FASTEST_MODE_CONFIG = {
    MAX_UNITS_BONUS: 4,
    MAX_DIFFICULTY_BONUS: 4,
    OVERLOAD_PENALTY_MULTIPLIER: 0.4,
    ALL_TECHNICAL_PENALTY_MULTIPLIER: 0.25
};

function getEffectiveMaxUnitsPerQuarter() {
    return PLANNING_CONFIG.MAX_UNITS_PER_QUARTER +
        (planningSpeed === 'fastest' ? FASTEST_MODE_CONFIG.MAX_UNITS_BONUS : 0);
}

function getEffectiveWorkloadConfig() {
    if (planningSpeed !== 'fastest') return WORKLOAD_CONFIG;
    return {
        ...WORKLOAD_CONFIG,
        MAX_DIFFICULTY_PER_QUARTER: WORKLOAD_CONFIG.MAX_DIFFICULTY_PER_QUARTER + FASTEST_MODE_CONFIG.MAX_DIFFICULTY_BONUS,
        OVERLOAD_PENALTY_PER_UNIT: WORKLOAD_CONFIG.OVERLOAD_PENALTY_PER_UNIT * FASTEST_MODE_CONFIG.OVERLOAD_PENALTY_MULTIPLIER,
        ALL_TECHNICAL_PENALTY: WORKLOAD_CONFIG.ALL_TECHNICAL_PENALTY * FASTEST_MODE_CONFIG.ALL_TECHNICAL_PENALTY_MULTIPLIER
    };
}

// Helper function to get element by new ID with fallback to old ID
function getElementByIdWithFallback(newId, oldId) {
    return document.getElementById(newId) || document.getElementById(oldId);
}

// Load from a pasted link to a published sheet (files load on pick, see
// handleQuickFileSelect). Pins and locks are reset by processTSVData only
// once the new data has loaded, so a failed fetch leaves the plan intact.
async function loadCourseData() {
    const urlInput = getElementByIdWithFallback('dataUrlNew', 'dataUrl');
    const errorMessage = document.getElementById('errorMessage');
    const url = urlInput.value.trim();

    try {
        document.body.classList.add('loading');
        errorMessage.style.display = 'none';
        if (!url) {
            throw new Error("Paste a link to a published sheet, or upload a CSV file.");
        }
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`The link returned an error (status ${response.status}). Check that the sheet is published to the web.`);
        }
        const tsvData = await response.text();
        graph = {};
        await processTSVData(tsvData);
        setDataSource('Google Sheet');
    } catch (error) {
        console.error("Error in loadCourseData:", error);
        showError("Couldn't load that link. " + error.message);
        document.body.classList.remove('loading');
    }
}

function readFileAsText(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = (e) => reject(new Error("Failed to read file"));
        reader.readAsText(file);
    });
}

async function processTSVData(tsvData) {
    const parsedData = parseTSV(tsvData);
    
    if (parsedData.length === 0) {
        throw new Error('No data found in TSV file');
    }

    // Validate required columns
    const requiredColumns = ['Course Number', 'Prerequisites', 'Description'];
    const optionalColumns = ['Taken', 'Planned', 'Corequisites', 'Req Satisfied', 'Units', 'Difficulty'];

    const firstRow = parsedData[0];
    const availableColumns = Object.keys(firstRow);

    const missingColumns = requiredColumns.filter(col => !availableColumns.includes(col));
    if (missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}. Required columns are: ${requiredColumns.join(', ')}`);
    }

    // Require at least one unit-like column
    if (!availableColumns.includes('Units') && !availableColumns.includes('Difficulty')) {
        throw new Error(`Missing unit column: provide either 'Units' or 'Difficulty'.`);
    }

    // Parse course data
    const courseData = parsedData.map((row, index) => ({
        id: row['Course Number'],
        name: row['Course Number'],
        prerequisites: parsePrerequisites(row['Prerequisites']),
        corequisites: (row['Corequisites'] && row['Corequisites'].trim().toLowerCase() !== 'none' && row['Corequisites'].trim() !== '')
                     ? row['Corequisites'].split(/,\s*|\/\s*/).map(p => p.trim()).filter(p => p)
                     : [],
        description: row['Description'],
        // Units and Difficulty are separate when both columns exist; older
        // sheets with only Difficulty use it for both.
        units: parseCourseNumber(row['Units']) ?? parseCourseNumber(row['Difficulty']) ?? 0,
        difficulty: parseCourseNumber(row['Difficulty']) ?? parseCourseNumber(row['Units']) ?? 0,
        reqSatisfied: row['Req Satisfied'] ? row['Req Satisfied'].trim() : 'Required', // New column for requirement category
        category: "Required", // Default all courses to Required
        taken: row['Taken'] ? row['Taken'].trim() : '',
        // Written by Export: where the course sat in the saved plan
        planned: row['Planned'] ? row['Planned'].trim() : '',
        enabled: true, // Toggled off from the Raw Data view to exclude a course from planning
        originalOrder: index
    }));

    // Validate the parsed data
    validateTSVData(courseData);

    // Show validation success message
    console.log(`✅ TSV Validation Passed: ${courseData.length} courses loaded successfully`);

    // If validation passes, assign to global variable
    ALL_CLASSES_DATA = courseData;

    // A new list starts with no plan: clear the last run and its message
    lastPlanRun = null;
    clearPlanStatus();

    // Initialize fresh quarters with no pinned courses or locks left over
    // from a previously loaded course list
    pinnedCourses = new Set();
    lockedQuarters = new Set();
    initializeQuarters();
    
    // Process courses with "Taken" assignments
    processTakenCourses();
    processPlannedCourses();
    
    // Recalculate dynamic settings based on the new course data
    updateDynamicSettings();
    
    renderPlanner();
    document.body.classList.remove('loading');
}

function validateTSVData(courseData) {
    const validationErrors = [];
    
    // 0. Check for empty or invalid course numbers
    courseData.forEach((course, index) => {
        const courseNumber = course.id.trim();
        if (!courseNumber || courseNumber === '') {
            validationErrors.push(`Empty course number found at row ${index + 2}`);
        }
    });
    
    // 1. Check for duplicate course numbers
    const courseNumbers = new Map();
    courseData.forEach((course, index) => {
        const courseNumber = course.id.trim();
        if (courseNumber) { // Only check non-empty course numbers
            if (courseNumbers.has(courseNumber)) {
                validationErrors.push(`Duplicate course number "${courseNumber}" found at rows ${courseNumbers.get(courseNumber) + 2} and ${index + 2}`);
            } else {
                courseNumbers.set(courseNumber, index);
            }
        }
    });

    // Create a set of all valid course numbers for prerequisite/corequisite checking
    const allCourseNumbers = new Set(courseData.map(course => course.id.trim()).filter(id => id));

    // 2. Check that all prerequisites exist as courses and are not self-referencing
    courseData.forEach((course, index) => {
        allPrereqIds(course).forEach(prereqId => {
            const prereqIdTrimmed = prereqId.trim();
            
            // Check for self-referencing prerequisite
            if (prereqIdTrimmed === course.id.trim()) {
                validationErrors.push(`Course "${course.id}" (row ${index + 2}) lists itself as a prerequisite`);
                return;
            }
            
            // Check if prerequisite exists
            if (!allCourseNumbers.has(prereqIdTrimmed)) {
                validationErrors.push(`Course "${course.id}" (row ${index + 2}) lists prerequisite "${prereqId}" which is not found in the course list`);
            }
        });
    });

    // 3. Check that corequisites are symmetric (mutual) and not self-referencing
    courseData.forEach((course, index) => {
        course.corequisites.forEach(coreqId => {
            const coreqIdTrimmed = coreqId.trim();
            
            // Check for self-referencing corequisite
            if (coreqIdTrimmed === course.id.trim()) {
                validationErrors.push(`Course "${course.id}" (row ${index + 2}) lists itself as a corequisite`);
                return;
            }
            
            // First check if the corequisite course exists
            if (!allCourseNumbers.has(coreqIdTrimmed)) {
                validationErrors.push(`Course "${course.id}" (row ${index + 2}) lists corequisite "${coreqId}" which is not found in the course list`);
                return;
            }

            // Find the corequisite course and check if it lists this course as a corequisite
            const coreqCourse = courseData.find(c => c.id.trim() === coreqIdTrimmed);
            if (coreqCourse) {
                const hasMutualCoreq = coreqCourse.corequisites.some(c => c.trim() === course.id.trim());
                if (!hasMutualCoreq) {
                    const coreqRowIndex = courseData.findIndex(c => c.id.trim() === coreqIdTrimmed) + 2;
                    validationErrors.push(`Asymmetric corequisite relationship: Course "${course.id}" (row ${index + 2}) lists "${coreqId}" as a corequisite, but "${coreqId}" (row ${coreqRowIndex}) does not list "${course.id}" as a corequisite`);
                }
            }
        });
    });

    // 4. Check for circular prerequisite dependencies (basic check)
    courseData.forEach((course, index) => {
        allPrereqIds(course).forEach(prereqId => {
            const prereqCourse = courseData.find(c => c.id.trim() === prereqId.trim());
            if (prereqCourse && allPrereqIds(prereqCourse).some(p => p.trim() === course.id.trim())) {
                validationErrors.push(`Circular prerequisite dependency detected between "${course.id}" (row ${index + 2}) and "${prereqId}"`);
            }
        });
    });

    // If there are validation errors, throw an error with all issues
    if (validationErrors.length > 0) {
        const errorMessage = formatValidationErrors(validationErrors);
        throw new Error(errorMessage);
    }
}

function formatValidationErrors(errors) {
    const header = `❌ TSV Validation Failed (${errors.length} issue${errors.length > 1 ? 's' : ''} found)`;
    const separator = '\n' + '─'.repeat(50) + '\n';
    
    const formattedErrors = errors.map((error, i) => {
        let suggestion = '';
        
        // Add helpful suggestions based on error type
        if (error.includes('Duplicate course number')) {
            suggestion = '\n   💡 Suggestion: Each course must have a unique course number. Please rename one of the duplicate courses.';
        } else if (error.includes('not found in the course list')) {
            suggestion = '\n   💡 Suggestion: Make sure the course name matches exactly (including spaces and capitalization) with a course listed in the Course Number column.';
        } else if (error.includes('Asymmetric corequisite')) {
            suggestion = '\n   💡 Suggestion: If Course A lists Course B as a corequisite, then Course B must also list Course A as a corequisite.';
        } else if (error.includes('lists itself as')) {
            suggestion = '\n   💡 Suggestion: A course cannot be its own prerequisite or corequisite. Please remove the self-reference.';
        } else if (error.includes('Circular prerequisite')) {
            suggestion = '\n   💡 Suggestion: Course A cannot be a prerequisite of Course B if Course B is a prerequisite of Course A.';
        } else if (error.includes('Empty course number')) {
            suggestion = '\n   💡 Suggestion: Every row must have a course number in the Course Number column.';
        }
        
        return `${i + 1}. ${error}${suggestion}`;
    });
    
    const footer = '\n\n📋 Please fix these issues in your spreadsheet and try loading the data again.';
    
    return header + separator + formattedErrors.join('\n\n') + footer;
}

function parseDelimited(text) {
    text = text.replace(/^\uFEFF/, '');
    if (text.trim() === '') return [];

    // Detect delimiter: check first line for tabs or commas
    const firstLine = text.split(/\r?\n/, 1)[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;

    const delimiter = tabCount > commaCount ? '\t' : ',';

    // Character-level parse so quoted fields may contain delimiters, escaped
    // quotes ("") and line breaks (Google Sheets exports multi-line cells).
    const rows = [];
    let row = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < text.length; i++) {
        const char = text[i];

        if (inQuotes) {
            if (char === '"' && text[i + 1] === '"') {
                current += '"';
                i++;
            } else if (char === '"') {
                inQuotes = false;
            } else {
                current += char;
            }
        } else if (char === '"') {
            inQuotes = true;
        } else if (char === delimiter) {
            row.push(current.trim());
            current = '';
        } else if (char === '\n' || char === '\r') {
            if (char === '\r' && text[i + 1] === '\n') i++;
            row.push(current.trim());
            rows.push(row);
            row = [];
            current = '';
        } else {
            current += char;
        }
    }
    row.push(current.trim());
    rows.push(row);

    // Skip blank lines and rows where every cell is empty (trailing sheet rows)
    const nonEmptyRows = rows.filter(r => r.some(value => value !== ''));
    if (nonEmptyRows.length < 1) return [];

    const headers = nonEmptyRows[0];

    return nonEmptyRows.slice(1).map(values =>
        headers.reduce((obj, header, index) => {
            obj[header] = values[index] || '';
            return obj;
        }, {})
    );
}

// Keep parseTSV as an alias for backwards compatibility
function parseTSV(tsvText) {
    return parseDelimited(tsvText);
}

// Course data comes from user-supplied (often shared) spreadsheets, so
// escape it before interpolating into HTML strings.
function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    
    // Escape (messages can echo course data), then keep line breaks
    const formattedMessage = escapeHtml(message).replace(/\n/g, '<br>');
    errorMessage.innerHTML = formattedMessage;
    errorMessage.style.display = 'block';
}

function calculateRequiredYears() {
    const graduationSelect = getElementByIdWithFallback('quartersToGraduateNew', 'quartersToGraduate');
    const customInput = getElementByIdWithFallback('customQuartersNew', 'customQuarters');

    const quartersToGrad = dynamicSettings.useCustomQuarters ? 
        dynamicSettings.customQuarters : 
        dynamicSettings.quartersToGraduate;
    
    if (currentAcademicSystem === 'quarter') {
        // Quarter system: 4 quarters per year
        return Math.ceil(quartersToGrad / 4);
    } else {
        // Semester system: 2 semesters per year
        return Math.ceil(quartersToGrad / 2);
    }
}

function initializeQuarters(numYears = null) {
    // If numYears not provided, calculate based on graduation timeline
    if (numYears === null) {
        numYears = calculateRequiredYears();
    }

    quartersData = [];

    // Define terms based on academic system
    const termNames = currentAcademicSystem === 'quarter'
        ? ["Summer", "Fall", "Winter", "Spring"]
        : ["Fall", "Spring"];

    for (let i = 0; i < numYears; i++) {
        termNames.forEach(termName => {
            quartersData.push({
                id: `${termName.toLowerCase()}${i + 1}`,
                name: `${termName} Year ${i + 1}`,
                year: i + 1,
                classes: [],
                pinnedClasses: [], // Track pinned courses in this quarter
                units: 0,
                backupOptions: [] // "Next best" courses that didn't make the cut this quarter
            });
        });
    }
    const unassignedClassesIds = ALL_CLASSES_DATA.filter(c => c.enabled !== false).map(c => c.id);
    quartersData.unshift({
        id: "unassigned",
        name: "Unassigned Classes",
        classes: unassignedClassesIds,
        pinnedClasses: [], // Unassigned can't have pinned courses
        units: 0
    });
}

// Prerequisites/corequisites pointing at a disabled or missing course are
// ignored, matching how auto-plan treats courses outside the planning graph.
function isActiveCourseId(classId) {
    const course = findClassById(classId);
    return !!course && course.enabled !== false;
}

// Prerequisites are a list of entries that must ALL be met (comma-separated
// in the sheet). An entry may be an OR-group written "CS 31 / CS 31E": it is
// met when ANY of its courses is done.
function parseCourseNumber(value) {
    const n = parseInt(value);
    return Number.isFinite(n) ? n : null;
}

// Difficulty drives workload balancing; saved data from before the separate
// column existed falls back to units.
function getCourseDifficulty(course) {
    return course.difficulty ?? course.units ?? 0;
}

function parsePrerequisites(raw) {
    if (!raw || raw.trim() === '' || raw.trim().toLowerCase() === 'none') return [];
    return raw.split(',')
        .map(entry => prereqAlternatives(entry).join(' / '))
        .filter(entry => entry);
}

function prereqAlternatives(entry) {
    return entry.split('/').map(id => id.trim()).filter(id => id);
}

// Every course id mentioned in a course's prerequisites, across OR-groups.
function allPrereqIds(course) {
    return course.prerequisites.flatMap(prereqAlternatives);
}

// isRelevant filters out alternatives to ignore (disabled/missing courses);
// an entry with no relevant alternatives left is treated as met.
function isPrereqEntryMet(entry, completed, isRelevant) {
    const alternatives = prereqAlternatives(entry).filter(isRelevant);
    return alternatives.length === 0 || alternatives.some(id => completed.has(id));
}

function findClassById(classId) {
    return ALL_CLASSES_DATA.find(c => c.id === classId);
}

function getQuarterById(quarterId) {
    return quartersData.find(q => q.id === quarterId);
}

function getQuarterChronologicalOrder(quarter) {
    if (!quarter || quarter.id === 'unassigned') return -1; 
    
    let seasonOrder = 0;
    if (currentAcademicSystem === 'quarter') {
        if (quarter.name.startsWith("Fall")) seasonOrder = 1;
        else if (quarter.name.startsWith("Winter")) seasonOrder = 2;
        else if (quarter.name.startsWith("Spring")) seasonOrder = 3;
        else if (quarter.name.startsWith("Summer")) seasonOrder = 0; // Summer comes first
        return (quarter.year - 1) * 4 + seasonOrder;
    } else {
        // Semester system
        if (quarter.name.startsWith("Fall")) seasonOrder = 0;
        else if (quarter.name.startsWith("Spring")) seasonOrder = 1;
        return (quarter.year - 1) * 2 + seasonOrder;
    }
}

function renderPlanner() {
    const unassignedContainer = document.getElementById('unassignedClasses');
    const yearsContainer = document.getElementById('years');
    
    unassignedContainer.innerHTML = '';
    yearsContainer.innerHTML = '';

    const unassignedQuarter = getQuarterById('unassigned');
    if (unassignedQuarter) { 
        unassignedQuarter.classes.forEach(classId => {
            const classData = findClassById(classId);
            if (classData) {
                unassignedContainer.appendChild(createClassCard(classData));
            }
        });
    }

    const academicQuarters = quartersData.filter(q => q.id !== 'unassigned')
                                       .sort((a,b) => getQuarterChronologicalOrder(a) - getQuarterChronologicalOrder(b));
    const numYears = academicQuarters.length > 0 ? Math.max(...academicQuarters.map(q => q.year)) : 0;

    for (let i = 1; i <= numYears; i++) {
        const yearDiv = document.createElement('div');
        yearDiv.className = 'year';
        yearDiv.innerHTML = `
            <div class="year-header-row">
                <span class="year-tab">YEAR ${String(i).padStart(2, '0')}</span>
                <h3>Year ${i}</h3>
                <span class="year-rule"></span>
            </div>
        `;
        
        const quartersDiv = document.createElement('div');
        quartersDiv.className = 'quarters';
        
        academicQuarters.filter(q => q.year === i).forEach(quarter => {
            const quarterDiv = document.createElement('div');
            quarterDiv.className = 'quarter drop-zone';
            quarterDiv.id = quarter.id;
            quarterDiv.dataset.quarterId = quarter.id; 

            // Add locked class if quarter is locked
            if (isQuarterLocked(quarter.id)) {
                quarterDiv.classList.add('locked');
            }

            const headerDiv = document.createElement('div');
            headerDiv.className = 'quarter-header';
            
            // Create lock button
            const lockButton = document.createElement('button');
            lockButton.className = 'quarter-lock-button';
            lockButton.innerHTML = isQuarterLocked(quarter.id) ? 
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" fill="currentColor"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4" fill="none"></path></svg>' : 
                '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 9.9-1"></path></svg>';
            lockButton.title = isQuarterLocked(quarter.id) ? 'Unlock term' : 'Lock term (keep all its courses here)';
            lockButton.setAttribute('aria-label', `${lockButton.title}: ${quarter.name}`);
            lockButton.onclick = (e) => {
                e.stopPropagation();
                toggleQuarterLock(quarter.id);
            };
            
            headerDiv.innerHTML = `<span>${quarter.name.replace(` Year ${i}`, '')}</span>
                                 <div class="quarter-info">
                                     <span class="quarter-units" id="units-${quarter.id}">${quarter.units} units</span>
                                 </div>`;

            // Add lock button to header
            headerDiv.appendChild(lockButton);
            quarterDiv.appendChild(headerDiv);

            quarter.classes.sort((aId, bId) => {
                const classA = findClassById(aId);
                const classB = findClassById(bId);
                if(classA && classB) return classA.originalOrder - classB.originalOrder;
                return 0;
            }).forEach(classId => {
                const classData = findClassById(classId);
                if (classData) {
                    quarterDiv.appendChild(createClassCard(classData));
                }
            });

            quartersDiv.appendChild(quarterDiv);
        });
        yearDiv.appendChild(quartersDiv);
        yearsContainer.appendChild(yearDiv);
    }
    const unassignedCount = document.getElementById('unassignedCount');
    if (unassignedCount) {
        const n = unassignedQuarter ? unassignedQuarter.classes.length : 0;
        unassignedCount.textContent = n > 0 ? `(${n})` : '';
    }
    updateDataBar();

    addDragDropListeners();
    updateAllUnitCounts();
    updateRequirementProgress(); // Update requirement progress dashboard
    updateUnitsInPlanCounter();
    validateAllPrerequisites();
    savePlanToLocalStorage();
}

// Auto-saves the course list + full plan to this browser on every change, so
// a reload restores your last session.
function savePlanToLocalStorage() {
    if (!ALL_CLASSES_DATA || ALL_CLASSES_DATA.length === 0) return;
    try {
        localStorage.setItem('plannerLocalState', JSON.stringify({
            courseData: ALL_CLASSES_DATA,
            quartersData,
            pinnedCourses: Array.from(pinnedCourses),
            lockedQuarters: Array.from(lockedQuarters),
            savedAt: Date.now()
        }));
    } catch (e) {
        // localStorage may be unavailable (private mode) or full; silently ignore
    }
}

// Returns true if a prior local session was restored.
function loadPlanFromLocalStorage() {
    let raw;
    try {
        raw = localStorage.getItem('plannerLocalState');
    } catch (e) {
        return false;
    }
    if (!raw) return false;

    try {
        const state = JSON.parse(raw);
        if (!state.courseData || state.courseData.length === 0) return false;

        ALL_CLASSES_DATA = state.courseData;
        quartersData = state.quartersData || [];
        pinnedCourses = new Set(state.pinnedCourses || []);
        lockedQuarters = new Set(state.lockedQuarters || []);
        return true;
    } catch (e) {
        return false;
    }
}

function updateUnitsInPlanCounter() {
    const counterEl = document.getElementById('unitsInPlanCounter');
    if (!counterEl) return;

    const activeCourses = ALL_CLASSES_DATA.filter(c => c.enabled !== false);
    const totalUnits = activeCourses.reduce((sum, c) => sum + (c.units || 0), 0);

    const unassignedQuarter = getQuarterById('unassigned');
    const unassignedIds = new Set(unassignedQuarter ? unassignedQuarter.classes : []);
    const plannedUnits = activeCourses
        .filter(c => !unassignedIds.has(c.id))
        .reduce((sum, c) => sum + (c.units || 0), 0);

    counterEl.textContent = totalUnits > 0 ? `${plannedUnits} / ${totalUnits} units planned` : '';
}

// Raw Data view — an editable snapshot of ALL_CLASSES_DATA. Nothing here
// affects the plan until applyRawDataToPlanner() is clicked.
function switchToView(view) {
    const plannerView = document.getElementById('plannerView');
    const rawView = document.getElementById('rawDataView');
    const tabPlanner = document.getElementById('viewTabPlanner');
    const tabRaw = document.getElementById('viewTabRaw');

    if (view === 'raw') {
        plannerView.style.display = 'none';
        rawView.style.display = 'block';
        tabPlanner.classList.remove('active');
        tabRaw.classList.add('active');
        renderRawDataTable();
    } else {
        plannerView.style.display = 'block';
        rawView.style.display = 'none';
        tabRaw.classList.remove('active');
        tabPlanner.classList.add('active');
    }
}

function renderRawDataTable() {
    const tbody = document.getElementById('rawDataTableBody');
    tbody.innerHTML = '';
    document.getElementById('rawDataError').style.display = 'none';

    if (ALL_CLASSES_DATA.length === 0) {
        const tr = document.createElement('tr');
        const td = document.createElement('td');
        td.colSpan = 9;
        td.className = 'raw-data-empty';
        td.textContent = 'No course data loaded yet. Upload a course list first, or click "+ Add Row" to start from scratch.';
        tr.appendChild(td);
        tbody.appendChild(tr);
        return;
    }

    ALL_CLASSES_DATA.forEach(course => {
        tbody.appendChild(createRawDataRow({
            enabled: course.enabled !== false,
            taken: course.taken || '',
            reqSatisfied: course.reqSatisfied || '',
            id: course.id || '',
            prerequisites: course.prerequisites.join(', '),
            corequisites: course.corequisites.join(', '),
            description: course.description || '',
            units: course.units != null ? String(course.units) : '',
            difficulty: String(getCourseDifficulty(course))
        }));
    });
}

function createRawDataRow(values) {
    values = values || {};
    const tr = document.createElement('tr');

    const enabledTd = document.createElement('td');
    enabledTd.dataset.col = 'enabled';
    const enabledCheckbox = document.createElement('input');
    enabledCheckbox.type = 'checkbox';
    enabledCheckbox.className = 'raw-data-checkbox';
    enabledCheckbox.dataset.field = 'enabled';
    enabledCheckbox.checked = values.enabled !== false;
    enabledCheckbox.title = 'Show this course in the planner';
    enabledCheckbox.onchange = () => tr.classList.toggle('raw-data-row-disabled', !enabledCheckbox.checked);
    enabledTd.appendChild(enabledCheckbox);
    tr.appendChild(enabledTd);
    if (values.enabled === false) tr.classList.add('raw-data-row-disabled');

    const fields = ['taken', 'reqSatisfied', 'id', 'prerequisites', 'corequisites', 'description', 'units', 'difficulty'];

    fields.forEach(field => {
        const td = document.createElement('td');
        td.dataset.col = field;
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'raw-data-input';
        input.dataset.field = field;
        input.value = values[field] || '';
        td.appendChild(input);
        tr.appendChild(td);
    });

    const actionTd = document.createElement('td');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'raw-data-remove';
    removeBtn.title = 'Remove row';
    removeBtn.textContent = '×';
    removeBtn.onclick = () => tr.remove();
    actionTd.appendChild(removeBtn);
    tr.appendChild(actionTd);

    return tr;
}

function addRawDataRow() {
    const tbody = document.getElementById('rawDataTableBody');
    const emptyRow = tbody.querySelector('.raw-data-empty');
    if (emptyRow) emptyRow.closest('tr').remove();
    tbody.appendChild(createRawDataRow({ enabled: true, taken: 'Not Assigned', prerequisites: 'None', corequisites: 'None' }));
}

function applyRawDataToPlanner() {
    const errorDiv = document.getElementById('rawDataError');
    errorDiv.style.display = 'none';

    const rows = document.querySelectorAll('#rawDataTableBody tr');
    const courseData = Array.from(rows)
        .filter(tr => !tr.querySelector('.raw-data-empty'))
        .map((tr, index) => {
            const get = (field) => tr.querySelector(`[data-field="${field}"]`).value.trim();
            const prereqRaw = get('prerequisites');
            const coreqRaw = get('corequisites');
            return {
                id: get('id'),
                name: get('id'),
                prerequisites: parsePrerequisites(prereqRaw),
                corequisites: (coreqRaw && coreqRaw.toLowerCase() !== 'none')
                    ? coreqRaw.split(/,\s*|\/\s*/).map(p => p.trim()).filter(p => p)
                    : [],
                description: get('description'),
                units: parseCourseNumber(get('units')) ?? 0,
                difficulty: parseCourseNumber(get('difficulty')) ?? parseCourseNumber(get('units')) ?? 0,
                reqSatisfied: get('reqSatisfied') || 'Required',
                category: 'Required',
                taken: get('taken'),
                enabled: tr.querySelector('[data-field="enabled"]').checked,
                originalOrder: index
            };
        });

    try {
        validateTSVData(courseData);
    } catch (e) {
        errorDiv.textContent = e.message;
        errorDiv.style.display = 'block';
        return;
    }

    // Keep existing placements, pins and locks for courses that still exist;
    // new or newly re-enabled courses are placed from their Taken value or
    // land in Unassigned.
    ALL_CLASSES_DATA = courseData;
    graph = {};
    rebuildQuartersKeepingPlacements();
    processTakenCourses();
    updateDynamicSettings();
    renderPlanner();

    showSuccessMessage('Applied changes. Your existing plan was kept.');
    switchToView('planner');
}

function createClassCard(classData) {
    const card = document.createElement('div');
    card.className = 'class-card';
    card.id = `class-${classData.id.replace(/\s+/g, '-')}`;
    card.draggable = true;
    card.dataset.classId = classData.id;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${classData.name}, ${classData.units} units. Open details`);

    if (isPinnedCourse(classData.id)) {
        card.classList.add('pinned');
    }
    if (graph[classData.id] && graph[classData.id].unassignedReason) {
        card.classList.add('class-card-unassigned-failed');
    }

    const code = document.createElement('span');
    code.className = 'card-code';
    code.textContent = classData.name;
    const title = document.createElement('span');
    title.className = 'card-title';
    title.textContent = classData.description || '';
    const units = document.createElement('span');
    units.className = 'units';
    units.textContent = `${classData.units} unit${classData.units === 1 ? '' : 's'}`;
    card.append(code, title, units);

    // Pin button (thumbtack icon, filled when pinned)
    const pinButton = document.createElement('button');
    pinButton.type = 'button';
    pinButton.className = 'pin-button';
    pinButton.innerHTML = isPinnedCourse(classData.id)
        ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 3a1 1 0 0 1 1 1v5.17l2.83 2.83a1 1 0 0 1-.71 1.71H13v6a1 1 0 1 1-2 0v-6H4.88a1 1 0 0 1-.71-1.71L7 9.17V4a1 1 0 0 1 1-1h8z"/></svg>'
        : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M16 3a1 1 0 0 1 1 1v5.17l2.83 2.83a1 1 0 0 1-.71 1.71H13v6a1 1 0 1 1-2 0v-6H4.88a1 1 0 0 1-.71-1.71L7 9.17V4a1 1 0 0 1 1-1h8z"/></svg>';
    pinButton.title = isPinnedCourse(classData.id) ? 'Unpin course' : 'Pin course to this term';
    pinButton.setAttribute('aria-label', pinButton.title);
    pinButton.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        handlePinToggle(classData.id);
    };
    card.appendChild(pinButton);

    // Category reads as a quiet left-edge accent, not a full-card recolor
    const categoryColor = getCategoryColor(classData.reqSatisfied);
    if (categoryColor) {
        card.style.setProperty('--card-accent', categoryColor.border);
    }

    // Click (or Enter) opens details — also the way to move courses on touch
    card.addEventListener('click', () => openCourseDetails(classData.id));
    card.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openCourseDetails(classData.id);
        }
    });

    return card;
}

// Get color for a requirement category
function getCategoryColor(reqSatisfied) {
    if (!reqSatisfied) return null;

    const colors = {
        'Lower Div': { bg: '#EAF0F7', border: '#3B6FA6', text: '#28517A' },
        'Major Core': { bg: '#F0ECF7', border: '#6B4FA0', text: '#4E3877' },
        '5 Elective': { bg: '#E9F3EC', border: '#3F8B5C', text: '#2E6844' },
        'Capstone': { bg: '#F6EFE0', border: '#B8862E', text: '#8C6521' },
        'Grad Level': { bg: '#F4EAF0', border: '#A34B84', text: '#7A3763' },
        'TB': { bg: '#F5F0DE', border: '#A68A1E', text: '#7C6816' },
        'ST': { bg: '#EAECF6', border: '#4A5FA6', text: '#37477D' },
        'GE': { bg: '#F5EBE2', border: '#B15E2E', text: '#864620' },
        'Probability': { bg: '#E4F1EF', border: '#1E8A82', text: '#166862' },
        'Stats & DS Minor': { bg: '#E6F0F5', border: '#2E82A6', text: '#23627C' },
        'Required': { bg: '#EEECE6', border: '#6B6459', text: '#524D44' }
    };

    // Check for partial matches (for categories that might have variations)
    for (const [key, value] of Object.entries(colors)) {
        if (reqSatisfied.includes(key)) {
            return value;
        }
    }

    return null;
}

// Requirement Progress Dashboard
function updateRequirementProgress() {
    // Count courses by requirement category
    const requirementCategories = {};

    // Get all courses currently in unassigned
    const unassignedQuarter = getQuarterById('unassigned');
    const unassignedCourseIds = unassignedQuarter ? unassignedQuarter.classes : [];

    ALL_CLASSES_DATA.forEach(course => {
        if (course.enabled === false) return;
        const categories = getCourseCategories(course);

        categories.forEach(category => {
            if (!requirementCategories[category]) {
                requirementCategories[category] = { total: 0, assigned: 0, totalUnits: 0, assignedUnits: 0 };
            }
            requirementCategories[category].total++;
            requirementCategories[category].totalUnits += (course.units || 0);

            // Check if course is assigned (not in unassigned)
            if (!unassignedCourseIds.includes(course.id)) {
                requirementCategories[category].assigned++;
                requirementCategories[category].assignedUnits += (course.units || 0);
            }
        });
    });

    // A configured graduation-requirement target overrides the auto-counted
    // total. A units target takes priority and switches the row to track
    // units instead of course count; otherwise a count target overrides just
    // the total; unconfigured falls back to however many are listed.
    Object.keys(requirementCategories).forEach(category => {
        const target = requirementTargets[category];
        if (!target) return;
        if (target.units != null) {
            requirementCategories[category].total = target.units;
            requirementCategories[category].assigned = requirementCategories[category].assignedUnits;
            requirementCategories[category].isUnits = true;
        } else if (target.count != null) {
            requirementCategories[category].total = target.count;
        }
    });

    // Update the dashboard
    const dashboardContainer = document.getElementById('requirement-dashboard');
    if (!dashboardContainer) return;

    let dashboardHTML = '';
    const sortedCategories = Object.entries(requirementCategories).sort((a, b) => {
        // Sort by total count descending, then alphabetically
        if (b[1].total !== a[1].total) return b[1].total - a[1].total;
        return a[0].localeCompare(b[0]);
    });

    sortedCategories.forEach(([category, stats]) => {
        const percentage = stats.total > 0 ? Math.round((stats.assigned / stats.total) * 100) : 0;
        const color = getCategoryColor(category);
        const bgColor = color ? color.border : '#6b7280';

        const unitSuffix = stats.isUnits ? 'u' : '';

        dashboardHTML += `
            <div class="requirement-item">
                <div class="requirement-header">
                    <span class="requirement-name" style="color: ${bgColor}">${escapeHtml(category)}</span>
                    <span class="requirement-count">${stats.assigned}${unitSuffix}/${stats.total}${unitSuffix}</span>
                </div>
                <div class="requirement-bar">
                    <div class="requirement-progress" style="width: ${percentage}%; background-color: ${bgColor}"></div>
                </div>
            </div>
        `;
    });

    dashboardContainer.innerHTML = dashboardHTML ||
        '<p class="requirements-empty">Load a course list to see requirement progress.</p>';

    const summary = document.getElementById('requirementsSummary');
    if (summary) {
        const complete = sortedCategories.filter(([, stats]) => stats.total > 0 && stats.assigned >= stats.total).length;
        summary.textContent = sortedCategories.length > 0
            ? `${complete} of ${sortedCategories.length} complete` : '';
    }
}

function handleFieldEdit(event) {
    // No longer needed - difficulty editing removed
}


// ----- Course details panel -----
let detailsCourseId = null;

function openCourseDetails(classId) {
    const course = findClassById(classId);
    if (!course) return;
    detailsCourseId = classId;
    renderCourseDetails();
    document.getElementById('courseDetailsOverlay').classList.add('active');
    document.getElementById('courseDetailsMoveSelect').focus();
}

function closeCourseDetails() {
    document.getElementById('courseDetailsOverlay').classList.remove('active');
    const card = detailsCourseId && document.querySelector(`[data-class-id="${CSS.escape(detailsCourseId)}"]`);
    detailsCourseId = null;
    if (card) card.focus();
}

function renderCourseDetails() {
    const course = findClassById(detailsCourseId);
    if (!course) return;
    const currentQuarter = quartersData.find(q => q.classes.includes(course.id));
    const placed = currentQuarter && currentQuarter.id !== 'unassigned';

    document.getElementById('courseDetailsTitle').textContent = course.name;
    const meta = [`${course.units} units`];
    if (course.difficulty != null && course.difficulty !== course.units) meta.push(`difficulty ${course.difficulty}`);
    meta.push(getCourseCategories(course).join(', ') || 'Required');
    meta.push(placed ? currentQuarter.name : 'Unassigned');
    if (isPinnedCourse(course.id)) meta.push('pinned');
    document.getElementById('courseDetailsMeta').textContent = meta.join(' · ');
    document.getElementById('courseDetailsDescription').textContent = course.description || '';

    // Why it's unassigned, or what's wrong with where it is
    let note = '';
    if (!placed && graph[course.id] && graph[course.id].unassignedReason) {
        note = graph[course.id].unassignedReason;
    } else if (placed) {
        const check = validateCoursePlacement(course.id, currentQuarter.id, { ignoreUnits: true });
        if (!check.isValid) note = check.reason;
    }
    const noteEl = document.getElementById('courseDetailsNote');
    noteEl.textContent = note;
    noteEl.hidden = !note;

    const unlocks = ALL_CLASSES_DATA.filter(c => c.enabled !== false && allPrereqIds(c).includes(course.id)).map(c => c.name);
    document.getElementById('courseDetailsPrereqs').textContent = course.prerequisites.join(', ') || 'None';
    document.getElementById('courseDetailsCoreqs').textContent = course.corequisites.join(', ') || 'None';
    document.getElementById('courseDetailsUnlocks').textContent = unlocks.join(', ') || 'Nothing';

    const select = document.getElementById('courseDetailsMoveSelect');
    select.innerHTML = '';
    const sorted = quartersData
        .filter(q => q.id !== 'unassigned')
        .sort((a, b) => getQuarterChronologicalOrder(a) - getQuarterChronologicalOrder(b));
    [getQuarterById('unassigned'), ...sorted].forEach(q => {
        if (!q) return;
        const option = document.createElement('option');
        option.value = q.id;
        const locked = isQuarterLocked(q.id);
        option.textContent = q.id === 'unassigned' ? 'Unassigned'
            : `${q.name} · ${q.units} units${locked ? ' (locked)' : ''}`;
        option.disabled = locked && q !== currentQuarter;
        option.selected = q === currentQuarter;
        select.appendChild(option);
    });

    document.getElementById('courseDetailsMoveMessage').hidden = true;

    const pinButton = document.getElementById('courseDetailsPinButton');
    pinButton.textContent = isPinnedCourse(course.id) ? 'Unpin' : 'Pin to this term';
    pinButton.disabled = !placed;
    pinButton.onclick = () => {
        handlePinToggle(course.id);
        renderCourseDetails();
    };
    document.getElementById('courseDetailsEditButton').onclick = () => {
        closeCourseDetails();
        showEditModal(course);
    };
}

function moveCourseFromDetails() {
    const targetId = document.getElementById('courseDetailsMoveSelect').value;
    const result = moveCourse(detailsCourseId, targetId);
    renderCourseDetails();
    const messageEl = document.getElementById('courseDetailsMoveMessage');
    messageEl.textContent = result.message || (result.moved ? 'Moved.' : '');
    messageEl.classList.toggle('is-warning', !!result.message);
    messageEl.hidden = !messageEl.textContent;
}

document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (document.getElementById('courseDetailsOverlay')?.classList.contains('active')) closeCourseDetails();
    else if (document.getElementById('settingsModalOverlay')?.classList.contains('active')) closeSettingsModal();
});

// ----- Inline status line (replaces alert() pop-ups) -----
// kind: 'success' | 'warning' | 'error'; actions: [{ label, onClick }]
function showPlanStatus(message, kind = 'success', actions = [], extra = null) {
    const el = document.getElementById('planStatus');
    if (!el) return;
    el.className = `plan-status is-${kind}`;
    el.innerHTML = '';
    const text = document.createElement('span');
    text.className = 'plan-status-text';
    text.textContent = message;
    el.appendChild(text);
    if (extra) el.appendChild(extra);
    actions.forEach(action => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'link-button';
        button.textContent = action.label;
        button.onclick = action.onClick;
        el.appendChild(button);
    });
    const dismiss = document.createElement('button');
    dismiss.type = 'button';
    dismiss.className = 'plan-status-dismiss';
    dismiss.setAttribute('aria-label', 'Dismiss');
    dismiss.textContent = '×';
    dismiss.onclick = clearPlanStatus;
    el.appendChild(dismiss);
    el.hidden = false;
}

function clearPlanStatus() {
    const el = document.getElementById('planStatus');
    if (el) el.hidden = true;
}

// Summarize an auto-plan run: everything placed, or what didn't fit and
// one-click ways to make room.
function reportPlanOutcome(run) {
    const nodes = Object.values(graph);
    const notNeeded = nodes.filter(n => !n.placed && n.unassignedReason.startsWith('Not needed'));
    const unplaced = nodes.filter(n => !n.placed && !n.unassignedReason.startsWith('Not needed'));
    const lastTerm = quartersData
        .filter(q => q.id !== 'unassigned' && q.classes.length > 0)
        .sort((a, b) => getQuarterChronologicalOrder(b) - getQuarterChronologicalOrder(a))[0];
    const finish = lastTerm ? ` Last term: ${lastTerm.name}.` : '';
    const skipped = notNeeded.length > 0
        ? ` ${notNeeded.length} left out because their requirement is already met.` : '';

    if (unplaced.length === 0) {
        showPlanStatus(`Every course fits.${finish}${skipped}`, 'success');
        return;
    }

    const requiredLeft = unplaced.filter(isRequiredCourse).length;
    let message = `${unplaced.length} course${unplaced.length === 1 ? '' : 's'} didn't fit`;
    if (requiredLeft > 0) message += `, including ${requiredLeft} required`;
    message += '.';
    const f = run.feasibility;
    if (f && !f.unitsFeasible) message += ` The open terms are ${f.shortfall} units short.`;
    if (f && !f.timelineFeasible) message += ` The longest prerequisite chain needs ${f.minQuartersForLongestChain} terms; ${f.academicQuarterCount} are open.`;
    message += ' See Unassigned for why.';

    const actions = [];
    const timeline = document.getElementById('quartersToGraduateNew');
    if (timeline && timeline.options && timeline.value !== 'custom' && timeline.selectedIndex < timeline.options.length - 2) {
        actions.push({ label: 'Add a year and re-plan', onClick: () => {
            timeline.selectedIndex += 1;
            updateDynamicSettings();
            autoPlanCoreCourses();
        } });
    }
    const maxNow = PLANNING_CONFIG.MAX_UNITS_PER_QUARTER;
    actions.push({ label: `Raise max to ${maxNow + 2} units and re-plan`, onClick: () => {
        handleMaxUnitsQuickChange(maxNow + 2);
        autoPlanCoreCourses();
    } });
    showPlanStatus(message, 'warning', actions);
}

// After a planning setting changes, the last Auto Plan result (and its
// message) no longer matches: e.g. a new Year 4 stays empty until re-planned.
function markPlanStale(what) {
    if (!lastPlanRun) return;
    showPlanStatus(`${what} changed, so the plan below is out of date.`, 'warning',
        [{ label: 'Re-plan now', onClick: () => autoPlanCoreCourses() }]);
}

// ----- Max units in the toolbar (blank = automatic) -----
function handleMaxUnitsQuickChange(value) {
    const n = parseInt(value);
    if (Number.isFinite(n) && n > 0) {
        PLANNING_CONFIG.MAX_UNITS_PER_QUARTER = n;
        PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER = true;
    } else {
        PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER = false;
    }
    updateDynamicSettings();
    markPlanStale('Max units');
}

function syncMaxUnitsQuick() {
    const input = document.getElementById('maxUnitsQuick');
    if (!input) return;
    input.value = PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER ? PLANNING_CONFIG.MAX_UNITS_PER_QUARTER : '';
    input.placeholder = `Auto (${PLANNING_CONFIG.MAX_UNITS_PER_QUARTER})`;
}

function showEditModal(course) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'edit-modal';
    modal.innerHTML = `
        <div class="edit-modal-content">
            <div class="edit-modal-header">
                <input type="color" id="edit-color" class="color-picker" value="${escapeHtml(course.color || '#ffffff')}">
                <h3>Edit Course: ${escapeHtml(course.name)}</h3>
            </div>
            <form id="edit-course-form">
                <div class="edit-form-group">
                    <label for="edit-name">Course Name</label>
                    <input type="text" id="edit-name" value="${escapeHtml(course.name)}">
                </div>
                <div class="edit-form-group">
                    <label for="edit-description">Description</label>
                    <textarea id="edit-description" rows="3">${escapeHtml(course.description || '')}</textarea>
                </div>
                <div class="edit-form-group">
                    <label for="edit-units">Units</label>
                    <input type="number" id="edit-units" value="${escapeHtml(course.units)}" min="1" max="10">
                </div>
                <div class="edit-form-group">
                    <label for="edit-reqsatisfied">Requirement Category</label>
                    <input type="text" id="edit-reqsatisfied" value="${escapeHtml(course.reqSatisfied || 'Required')}">
                </div>
                <div class="edit-form-group">
                    <label for="edit-prerequisites">Prerequisites (comma-separated)</label>
                    <input type="text" id="edit-prerequisites" value="${escapeHtml(course.prerequisites.join(', '))}">
                </div>
                <div class="edit-form-group">
                    <label for="edit-corequisites">Corequisites (comma-separated)</label>
                    <input type="text" id="edit-corequisites" value="${escapeHtml(course.corequisites.join(', '))}">
                </div>
                <div class="edit-form-actions">
                    <button type="button" class="cancel">Cancel</button>
                    <button type="submit" class="save">Save Changes</button>
                </div>
            </form>
        </div>
    `;

    document.body.appendChild(modal);

    // Handle form submission
    const form = modal.querySelector('#edit-course-form');
    form.addEventListener('submit', (e) => {
        e.preventDefault();

        // Update course data
        course.name = document.getElementById('edit-name').value.trim();
        course.description = document.getElementById('edit-description').value.trim();
        course.units = parseInt(document.getElementById('edit-units').value) || course.units;
        course.reqSatisfied = document.getElementById('edit-reqsatisfied').value.trim() || 'Required';
        course.color = document.getElementById('edit-color').value;

        // Parse prerequisites and corequisites
        const prereqsText = document.getElementById('edit-prerequisites').value.trim();
        course.prerequisites = parsePrerequisites(prereqsText);
        
        const coreqsText = document.getElementById('edit-corequisites').value.trim();
        course.corequisites = coreqsText ? coreqsText.split(',').map(c => c.trim()).filter(c => c) : [];
        
        // Close modal and re-render
        document.body.removeChild(modal);
        renderPlanner();
    });
    
    // Handle cancel
    modal.querySelector('.cancel').addEventListener('click', () => {
        document.body.removeChild(modal);
    });
    
    // Close modal when clicking outside
    modal.addEventListener('click', (e) => {
        if (e.target === modal) {
            document.body.removeChild(modal);
        }
    });
    
    // Focus first input
    document.getElementById('edit-name').focus();
}

function handlePinToggle(classId) {
    if (isPinnedCourse(classId)) {
        unpinCourse(classId);
    } else {
        // Find current quarter of the course
        const currentQuarter = quartersData.find(q => q.classes.includes(classId));
        if (currentQuarter && currentQuarter.id !== 'unassigned') {
            // Check if the course is currently marked as invalid (red)
            const cardElement = document.getElementById(`class-${classId.replace(/\s+/g, '-')}`);
            if (cardElement && cardElement.classList.contains('invalid')) {
                showPlanStatus(`Can't pin ${classId}: a prerequisite isn't scheduled before it. Fix that first.`, 'error');
                return;
            }
            
            pinCourse(classId, currentQuarter.id);
        } else {
            showPlanStatus('Move the course into a term before pinning it.', 'error');
        }
    }
}

function addDragDropListeners() {
    const classCards = document.querySelectorAll('.class-card');
    classCards.forEach(card => {
        card.addEventListener('dragstart', handleDragStart);
        card.addEventListener('dragend', handleDragEnd);
    });

    const dropZones = document.querySelectorAll('.drop-zone');
    dropZones.forEach(zone => {
        zone.addEventListener('dragover', handleDragOver);
        zone.addEventListener('dragleave', handleDragLeave);
        zone.addEventListener('drop', handleDrop);
    });
}

function handleDragStart(e) {
    draggedClassId = e.target.dataset.classId;
    e.dataTransfer.setData('text/plain', draggedClassId);
    e.target.classList.add('dragging');
    
    // Highlight prerequisite dependencies
    highlightPrerequisiteDependencies(draggedClassId);
    
    // Start tracking mouse movement for line updates
    document.addEventListener('dragover', updateLinePositions);
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedClassId = null; 
    
    // Stop tracking mouse movement
    document.removeEventListener('dragover', updateLinePositions);
    
    // Clear highlighting
    clearPrerequisiteHighlighting();
}

function handleDragOver(e) {
    e.preventDefault(); 
    const dropZone = e.target.closest('.drop-zone');
    if (dropZone) {
        dropZone.classList.add('drop-target-hover');
        
        // Show conflict info when hovering
        if (draggedClassId) {
            const targetQuarterId = dropZone.id === 'unassignedClasses' ? 'unassigned' : dropZone.dataset.quarterId;
            const validation = validateCoursePlacement(draggedClassId, targetQuarterId);
            
            if (!validation.isValid) {
                dropZone.title = validation.reason;
            } else {
                dropZone.title = '';
            }
        }
    }
}

function handleDragLeave(e) {
    const dropZone = e.target.closest('.drop-zone');
    if (dropZone) {
        dropZone.classList.remove('drop-target-hover');
        dropZone.title = '';
    }
}

function highlightPrerequisiteDependencies(courseId) {
    const course = ALL_CLASSES_DATA.find(c => c.id === courseId);
    if (!course) return;
    
    // Create overlay for lines
    const overlay = document.createElement('div');
    overlay.id = 'prerequisite-overlay';
    overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        pointer-events: none;
        z-index: 9999;
    `;
    document.body.appendChild(overlay);
    
    // Find all courses that have this course as prerequisite
    const dependentCourses = ALL_CLASSES_DATA.filter(c => 
        allPrereqIds(c).includes(courseId)
    );
    
    // Find the dragged course element
    const draggedElement = document.querySelector(`[data-class-id="${courseId}"]`);
    if (!draggedElement) return;
    
    const draggedRect = draggedElement.getBoundingClientRect();
    const draggedCenter = {
        x: draggedRect.left + draggedRect.width / 2,
        y: draggedRect.top + draggedRect.height / 2
    };
    
    // Highlight dependent courses
    dependentCourses.forEach(dependentCourse => {
        const depElement = document.querySelector(`[data-class-id="${dependentCourse.id}"]`);
        if (depElement) {
            // Add highlight class
            depElement.classList.add('prerequisite-dependent');
            
            // Draw line
            const depRect = depElement.getBoundingClientRect();
            const depCenter = {
                x: depRect.left + depRect.width / 2,
                y: depRect.top + depRect.height / 2
            };
            
            drawLine(overlay, draggedCenter, depCenter, 'prerequisite-line');
        }
    });
    
    // Also highlight prerequisites of the dragged course
    allPrereqIds(course).forEach(prereqId => {
        const prereqElement = document.querySelector(`[data-class-id="${prereqId}"]`);
        if (prereqElement) {
            prereqElement.classList.add('prerequisite-prerequisite');
            
            // Draw line from prerequisite to dragged course
            const prereqRect = prereqElement.getBoundingClientRect();
            const prereqCenter = {
                x: prereqRect.left + prereqRect.width / 2,
                y: prereqRect.top + prereqRect.height / 2
            };
            
            drawLine(overlay, prereqCenter, draggedCenter, 'prerequisite-line');
        }
    });
}

function drawLine(container, start, end, className) {
    const line = document.createElement('div');
    line.className = className;
    
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const length = Math.sqrt(dx * dx + dy * dy);
    const angle = Math.atan2(dy, dx) * 180 / Math.PI;
    
    line.style.cssText = `
        position: absolute;
        left: ${start.x}px;
        top: ${start.y}px;
        width: ${length}px;
        height: 2px;
        background-color: #ff6b6b;
        transform-origin: 0 50%;
        transform: rotate(${angle}deg);
        opacity: 0.8;
        z-index: 10000;
    `;
    
    container.appendChild(line);
}

function clearPrerequisiteHighlighting() {
    // Remove overlay
    const overlay = document.getElementById('prerequisite-overlay');
    if (overlay) {
        overlay.remove();
    }
    
    // Remove highlight classes
    document.querySelectorAll('.prerequisite-dependent, .prerequisite-prerequisite').forEach(el => {
        el.classList.remove('prerequisite-dependent', 'prerequisite-prerequisite');
    });
}

function updateLinePositions(e) {
    const overlay = document.getElementById('prerequisite-overlay');
    if (!overlay || !draggedClassId) return;
    
    // Clear existing lines
    overlay.querySelectorAll('.prerequisite-line').forEach(line => line.remove());
    
    const course = ALL_CLASSES_DATA.find(c => c.id === draggedClassId);
    if (!course) return;
    
    // Get current mouse position
    const mousePos = { x: e.clientX, y: e.clientY };
    
    // Find all courses that have this course as prerequisite
    const dependentCourses = ALL_CLASSES_DATA.filter(c => 
        allPrereqIds(c).includes(draggedClassId)
    );
    
    // Draw lines from mouse position to dependent courses
    dependentCourses.forEach(dependentCourse => {
        const depElement = document.querySelector(`[data-class-id="${dependentCourse.id}"]`);
        if (depElement) {
            const depRect = depElement.getBoundingClientRect();
            const depCenter = {
                x: depRect.left + depRect.width / 2,
                y: depRect.top + depRect.height / 2
            };
            
            drawLine(overlay, mousePos, depCenter, 'prerequisite-line');
        }
    });
    
    // Draw lines from prerequisites to mouse position
    allPrereqIds(course).forEach(prereqId => {
        const prereqElement = document.querySelector(`[data-class-id="${prereqId}"]`);
        if (prereqElement) {
            const prereqRect = prereqElement.getBoundingClientRect();
            const prereqCenter = {
                x: prereqRect.left + prereqRect.width / 2,
                y: prereqRect.top + prereqRect.height / 2
            };
            
            drawLine(overlay, prereqCenter, mousePos, 'prerequisite-line');
        }
    });
}

function handleDrop(e) {
    e.preventDefault();
    const targetDropZoneEl = e.target.closest('.drop-zone');
    if (!targetDropZoneEl) return;

    targetDropZoneEl.classList.remove('drop-target-hover');
    const classId = e.dataTransfer.getData('text/plain');
    const targetQuarterId = targetDropZoneEl.id === 'unassignedClasses' ? 'unassigned' : targetDropZoneEl.dataset.quarterId;

    const result = moveCourse(classId, targetQuarterId);
    if (result.message) {
        showConflictMessage(result.message, e.clientX, e.clientY);
    }
}

// Move a course to a quarter (or 'unassigned'). Used by drag and drop and by
// the course details panel. Returns { moved, message }: the move is refused
// for locked quarters; it goes ahead with a message when it breaks a
// prerequisite (the card turns red).
function moveCourse(classId, targetQuarterId) {
    const originalQuarter = quartersData.find(q => q.classes.includes(classId));
    const newQuarter = getQuarterById(targetQuarterId);
    if (!newQuarter || originalQuarter === newQuarter) return { moved: false, message: '' };

    if ((originalQuarter && isQuarterLocked(originalQuarter.id)) || isQuarterLocked(targetQuarterId)) {
        return { moved: false, message: 'Unlock the term first to move courses in or out of it.' };
    }

    const validationResult = validateCoursePlacement(classId, targetQuarterId);

    if (originalQuarter) {
        originalQuarter.classes = originalQuarter.classes.filter(id => id !== classId);
        // A pin belongs to a quarter: move it with the course, or drop it when
        // the course goes back to Unassigned.
        if (originalQuarter.pinnedClasses && originalQuarter.pinnedClasses.includes(classId)) {
            originalQuarter.pinnedClasses = originalQuarter.pinnedClasses.filter(id => id !== classId);
            if (targetQuarterId === 'unassigned') {
                pinnedCourses.delete(classId);
            } else {
                newQuarter.pinnedClasses.push(classId);
            }
        }
    }
    newQuarter.classes.push(classId);
    if (graph[classId]) graph[classId].unassignedReason = '';

    // The last Auto Plan summary no longer describes the plan
    clearPlanStatus();
    renderPlanner();
    return { moved: true, message: validationResult.isValid ? '' : validationResult.reason };
}

// options.ignoreUnits: check only prerequisites/corequisites (used to explain
// a course that's already in the quarter).
function validateCoursePlacement(classId, targetQuarterId, options = {}) {
    if (targetQuarterId === 'unassigned') {
        return { isValid: true, reason: '' };
    }

    const course = findClassById(classId);
    if (!course) {
        return { isValid: false, reason: 'Course not found' };
    }

    const targetQuarter = getQuarterById(targetQuarterId);
    if (!targetQuarter) {
        return { isValid: false, reason: 'Quarter not found' };
    }

    // Get courses completed before this quarter
    const completedBeforeQuarter = getCompletedCoursesBeforeQuarter(targetQuarterId);
    
    // Check prerequisites
    for (const entry of course.prerequisites) {
        if (!isPrereqEntryMet(entry, completedBeforeQuarter, isActiveCourseId)) {
            return { isValid: false, reason: `Missing prerequisite: ${entry}` };
        }
    }

    // Check corequisites
    for (const coreqId of course.corequisites) {
        if (isActiveCourseId(coreqId) && !completedBeforeQuarter.has(coreqId) &&
            !targetQuarter.classes.includes(coreqId)) {
            const coreqCourse = findClassById(coreqId);
            const coreqName = coreqCourse ? coreqCourse.id : coreqId;
            return { isValid: false, reason: `Missing corequisite: ${coreqName} (take it earlier or in the same quarter)` };
        }
    }

    if (options.ignoreUnits) {
        return { isValid: true, reason: '' };
    }

    // Check unit limits
    const currentUnits = targetQuarter.units;
    const newUnits = currentUnits + course.units;
    const maxUnits = getEffectiveMaxUnitsPerQuarter();
    if (newUnits > maxUnits) {
        return { isValid: false, reason: `Would exceed max units (${maxUnits}). Current: ${currentUnits}, Adding: ${course.units}` };
    }

    return { isValid: true, reason: '' };
}

function getCompletedCoursesBeforeQuarter(targetQuarterId) {
    const completed = new Set();

    // Add courses from quarters before the target quarter (summer is ordered
    // first within its year, so it only counts for later quarters)
    const targetOrder = getQuarterChronologicalOrder(getQuarterById(targetQuarterId));
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned' && quarter.id !== targetQuarterId) {
            const quarterOrder = getQuarterChronologicalOrder(quarter);
            if (quarterOrder < targetOrder) {
                quarter.classes.forEach(courseId => completed.add(courseId));
            }
        }
    });

    return completed;
}

function showConflictMessage(reason, x, y) {
    // Remove any existing conflict messages
    const existingMessages = document.querySelectorAll('.conflict-message');
    existingMessages.forEach(msg => msg.remove());

    const messageDiv = document.createElement('div');
    messageDiv.className = 'conflict-message';
    messageDiv.textContent = reason;
    messageDiv.style.cssText = `
        position: fixed;
        top: ${y - 40}px;
        left: ${x}px;
        background: #fee2e2;
        color: #dc2626;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 12px;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(220, 38, 38, 0.2);
        border: 1px solid #fca5a5;
        z-index: 10000;
        max-width: 250px;
        pointer-events: none;
        animation: fadeInOut 3s ease-in-out;
    `;

    document.body.appendChild(messageDiv);

    // Auto-remove after 3 seconds
    setTimeout(() => {
        if (messageDiv.parentNode) {
            messageDiv.remove();
        }
    }, 3000);
}

function validateAllPrerequisites() {
    document.querySelectorAll('.class-card').forEach(cardEl => cardEl.classList.remove('invalid'));

    const academicQuartersSorted = quartersData
        .filter(q => q.id !== 'unassigned')
        .sort((a, b) => getQuarterChronologicalOrder(a) - getQuarterChronologicalOrder(b));
    
    let completedClassesCumulative = new Set();

    academicQuartersSorted.forEach(quarter => {
        quarter.classes.forEach(classId => {
            const classData = findClassById(classId);
            if (!classData) return;

            let isInvalid = false;

            // Check prerequisites
            if (classData.prerequisites.length > 0) {
                let prereqsMet = true;
                for (const entry of classData.prerequisites) {
                    if (!isPrereqEntryMet(entry, completedClassesCumulative, isActiveCourseId)) {
                        prereqsMet = false;
                        break;
                    }
                }
                if (!prereqsMet) {
                    isInvalid = true;
                }
            }

            // Check corequisites
            if (classData.corequisites.length > 0) {
                let coreqsMet = true;
                for (const coreqId of classData.corequisites) {
                    // Corequisite must be taken earlier or in the same quarter
                    if (isActiveCourseId(coreqId) && !quarter.classes.includes(coreqId) &&
                        !completedClassesCumulative.has(coreqId)) {
                        coreqsMet = false;
                        break;
                    }
                }
                if (!coreqsMet) {
                    isInvalid = true;
                }
            }

            const cardElement = document.getElementById(`class-${classId.replace(/\s+/g, '-')}`);
            if (cardElement && isInvalid) {
                cardElement.classList.add('invalid');
            }
        });
        quarter.classes.forEach(cid => completedClassesCumulative.add(cid));
    });
}

function updateQuarterUnits(quarterId) {
    const quarter = getQuarterById(quarterId);
    if (!quarter || quarter.id === 'unassigned') return;

    let totalUnits = 0;
    quarter.classes.forEach(classId => {
        const classData = findClassById(classId);
        if (classData) {
            totalUnits += classData.units;
        }
    });
    quarter.units = totalUnits;
    
    const unitsDisplay = document.getElementById(`units-${quarter.id}`);
    if (unitsDisplay) {
        unitsDisplay.textContent = `${totalUnits} units`;
    }
}

function updateAllUnitCounts() {
    quartersData.forEach(q => {
        if (q.id !== 'unassigned') {
            updateQuarterUnits(q.id);
        }
    });
}

function initializePlanningGraph() {
    const graph = {};
    const coursesToConsiderForPlanning = ALL_CLASSES_DATA
        .filter(course => course && course.enabled !== false &&
            (course.category === "Required" || course.category === "Capstone" || course.category === "External"))
        .sort((a, b) => a.originalOrder - b.originalOrder);

    coursesToConsiderForPlanning.forEach(course => {
        graph[course.id] = {
            course,
            prerequisites: course.prerequisites,
            corequisites: course.corequisites,
            dependents: [],
            dependencyDepth: 0,
            placed: false,
            unassignedReason: '',
            originalOrder: course.originalOrder
        };
    });

    // Build dependency relationships
    Object.values(graph).forEach(node => {
        node.prerequisites.flatMap(prereqAlternatives).forEach(prereqId => {
            if (graph[prereqId]) {
                graph[prereqId].dependents.push(node.course.id);
            }
        });
    });

    // Compute dependency depth: longest chain from this course to a leaf dependent.
    // Courses at the top of long chains (e.g. CS 31 → CS 32 → CS 33 → CS 111) get
    // scheduled first so they don't get pushed later than necessary.
    computeDependencyDepth(graph);

    return graph;
}

function computeDependencyDepth(graph) {
    const memo = new Map();
    const visiting = new Set();

    function depth(nodeId) {
        if (memo.has(nodeId)) return memo.get(nodeId);
        const node = graph[nodeId];
        if (!node) return 0;
        if (visiting.has(nodeId)) return 0; // cycle guard

        visiting.add(nodeId);
        let maxChild = 0;
        for (const depId of node.dependents) {
            maxChild = Math.max(maxChild, depth(depId));
        }
        visiting.delete(nodeId);

        const d = 1 + maxChild;
        memo.set(nodeId, d);
        return d;
    }

    Object.values(graph).forEach(node => {
        node.dependencyDepth = depth(node.course.id);
    });
}

function syncCategoryPriorityWithData() {
    if (!ALL_CLASSES_DATA || ALL_CLASSES_DATA.length === 0) return;

    const dataCategories = [...new Set(
        ALL_CLASSES_DATA.flatMap(getCourseCategories)
    )];

    if (categoryPriority.length === 0) {
        categoryPriority = getDefaultCategoryPriority(dataCategories);
        return;
    }

    // Drop categories no longer present in the data
    categoryPriority = categoryPriority.filter(c => dataCategories.includes(c));
    // Append any new categories (in default order then discovery order)
    const knownNew = DEFAULT_CATEGORY_PRIORITY.filter(c =>
        dataCategories.includes(c) && !categoryPriority.includes(c)
    );
    const unknownNew = dataCategories.filter(c =>
        !DEFAULT_CATEGORY_PRIORITY.includes(c) && !categoryPriority.includes(c)
    );
    categoryPriority = [...categoryPriority, ...knownNew, ...unknownNew];
}

function getDefaultCategoryPriority(dataCategories) {
    const known = DEFAULT_CATEGORY_PRIORITY.filter(c => dataCategories.includes(c));
    const unknown = dataCategories.filter(c => !DEFAULT_CATEGORY_PRIORITY.includes(c));
    return [...known, ...unknown];
}

// Derive numeric requirement weights from the current category-priority order.
// Index 0 (top of the list) gets the largest value; lower ranks decay.
function deriveRequirementWeights() {
    const values = [...DEFAULT_REQUIREMENT_WEIGHTS_BY_RANK];
    while (values.length < categoryPriority.length) {
        const last = values[values.length - 1];
        values.push(Math.max(1, last - 3));
    }
    const weights = {};
    categoryPriority.forEach((cat, idx) => {
        weights[cat] = values[idx] ?? 1;
    });
    return weights;
}

// True if a course counts toward the degree (Major Core, Capstone, etc.).
// Used for the spec's required-vs-elective unlock split.
function isRequiredCourse(courseNode) {
    return !!courseNode && getCourseCategories(courseNode.course).some(c => REQUIRED_CATEGORIES.has(c));
}

// Transitive closure of dependents, excluding direct dependents themselves.
// BFS starting from direct dependents, traversing their dependents, and so on.
function getIndirectUnlocks(courseId, graph) {
    const node = graph[courseId];
    if (!node) return [];

    const direct = new Set(node.dependents);
    const indirect = new Set();
    const visited = new Set(node.dependents);
    const queue = [...node.dependents];

    while (queue.length > 0) {
        const id = queue.shift();
        const current = graph[id];
        if (!current) continue;
        current.dependents.forEach(d => {
            if (visited.has(d)) return;
            visited.add(d);
            if (!direct.has(d)) indirect.add(d);
            queue.push(d);
        });
    }
    return Array.from(indirect);
}

// Spec's weighted priority score:
//   10·requiredDirect + 6·requiredIndirect + 5·electiveDirect + 3·electiveIndirect
//   + 8·longestChain + requirementWeight - 2·difficulty
function computePriorityScore(courseNode, graph, requirementWeights) {
    const course = courseNode.course;

    const directUnlocks = courseNode.dependents;
    const indirectUnlocks = getIndirectUnlocks(course.id, graph);

    const directUnlockNodes = directUnlocks.map(id => graph[id]).filter(Boolean);
    const indirectUnlockNodes = indirectUnlocks.map(id => graph[id]).filter(Boolean);

    const requiredDirect = directUnlockNodes.filter(isRequiredCourse).length;
    const electiveDirect = directUnlockNodes.length - requiredDirect;
    const requiredIndirect = indirectUnlockNodes.filter(isRequiredCourse).length;
    const electiveIndirect = indirectUnlockNodes.length - requiredIndirect;

    const longestChain = courseNode.dependencyDepth;
    // A course counting toward several categories takes the highest weight
    const requirementWeight = Math.max(1,
        ...getCourseCategories(course).map(c => requirementWeights[c] ?? 1));
    const difficultyPenalty = getCourseDifficulty(course) * 2;

    return (
        10 * requiredDirect +
         6 * requiredIndirect +
         5 * electiveDirect +
         3 * electiveIndirect +
         8 * longestChain +
         requirementWeight -
         difficultyPenalty
    );
}

// Generate all subsets of eligible nodes whose combined units fit under the
// remaining unit budget for this quarter. Caps subset size at 5 to bound the
// search (C(N,5) is fine for typical N=8-12 eligible courses).
function generateUnitFeasibleCombinations(eligible, remainingUnitBudget) {
    const combos = [];
    const MAX_COMBO_SIZE = 5;

    function backtrack(start, current, currentUnits) {
        if (current.length > 0) combos.push([...current]);
        if (current.length >= MAX_COMBO_SIZE) return;

        for (let i = start; i < eligible.length; i++) {
            const node = eligible[i];
            if (currentUnits + node.course.units > remainingUnitBudget) continue;
            current.push(node);
            backtrack(i + 1, current, currentUnits + node.course.units);
            current.pop();
        }
    }

    backtrack(0, [], 0);
    return combos;
}

// Score a candidate combination for a quarter. Higher is better.
function scoreCombination(combo, quarter, scores) {
    if (combo.length === 0) return -Infinity;

    const workloadConfig = getEffectiveWorkloadConfig();

    let score = combo.reduce((sum, node) => sum + scores.get(node.course.id), 0);

    const addedUnits = combo.reduce((s, n) => s + n.course.units, 0);
    const totalUnits = quarter.units + addedUnits;

    score += combo.filter(isRequiredCourse).length * workloadConfig.REQUIRED_COURSE_BONUS;
    score += combo.length * workloadConfig.PLACEMENT_BONUS;

    // Over-difficulty penalty: total difficulty of what's already in the
    // quarter plus this combination
    const existingDifficulty = quarter.classes.reduce((sum, id) => {
        const course = findClassById(id);
        return sum + (course ? getCourseDifficulty(course) : 0);
    }, 0);
    const totalDifficulty = existingDifficulty +
        combo.reduce((sum, n) => sum + getCourseDifficulty(n.course), 0);
    if (totalDifficulty > workloadConfig.MAX_DIFFICULTY_PER_QUARTER) {
        score -= (totalDifficulty - workloadConfig.MAX_DIFFICULTY_PER_QUARTER)
            * workloadConfig.OVERLOAD_PENALTY_PER_UNIT;
    }

    // Under-min penalty: a small combo that leaves the quarter well below
    // min units is wasteful (we'd rather fill it).
    if (totalUnits < PLANNING_CONFIG.MIN_UNITS_PER_QUARTER) {
        const shortfall = PLANNING_CONFIG.MIN_UNITS_PER_QUARTER - totalUnits;
        score -= shortfall * 5;
    }

    // Balance bonus: mix of technical and non-technical courses
    const techCount = combo.filter(n => isTechnicalCourse(n.course)).length;
    const nonTechCount = combo.length - techCount;
    if (techCount >= 2 && nonTechCount >= 1 && combo.length >= 3) {
        score += workloadConfig.BALANCED_BONUS;
    }
    if (techCount === combo.length && combo.length >= 4) {
        score -= workloadConfig.ALL_TECHNICAL_PENALTY;
    }

    return score;
}

function isTechnicalCourse(course) {
    return getCourseCategories(course).some(c =>
        REQUIRED_CATEGORIES.has(c) || c === '5 Elective' || c === 'ST' || c === 'Grad Level');
}

function loadCategoryPriorityUI() {
    const list = document.getElementById('categoryPriorityList');
    if (!list) return;

    syncCategoryPriorityWithData();

    list.innerHTML = '';
    categoryPriority.forEach((category, index) => {
        const li = document.createElement('li');
        li.className = 'category-priority-item';
        li.draggable = true;
        li.dataset.category = category;

        const handle = document.createElement('span');
        handle.className = 'drag-handle';
        handle.textContent = '⋮⋮';

        const rank = document.createElement('span');
        rank.className = 'priority-rank';
        rank.textContent = index + 1;

        const name = document.createElement('span');
        name.className = 'category-name';
        name.textContent = category;

        li.appendChild(handle);
        li.appendChild(rank);
        li.appendChild(name);
        attachCategoryDragHandlers(li);

        list.appendChild(li);
    });
}

function attachCategoryDragHandlers(li) {
    li.addEventListener('dragstart', (e) => {
        draggedCategoryItem = li;
        li.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
    });

    li.addEventListener('dragend', () => {
        li.classList.remove('dragging');
        draggedCategoryItem = null;
        // Rebuild priority from current DOM order and refresh rank labels
        const list = document.getElementById('categoryPriorityList');
        if (!list) return;
        const newOrder = Array.from(list.children).map(item => item.dataset.category);
        categoryPriority = newOrder;
        Array.from(list.children).forEach((item, idx) => {
            const rank = item.querySelector('.priority-rank');
            if (rank) rank.textContent = idx + 1;
        });
        persistCategoryPriority();
    });

    li.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (!draggedCategoryItem || draggedCategoryItem === li) return;
        const list = document.getElementById('categoryPriorityList');
        const rect = li.getBoundingClientRect();
        const midpoint = rect.top + rect.height / 2;
        if (e.clientY < midpoint) {
            list.insertBefore(draggedCategoryItem, li);
        } else {
            list.insertBefore(draggedCategoryItem, li.nextSibling);
        }
    });
}

function persistCategoryPriority() {
    try {
        localStorage.setItem('categoryPriority', JSON.stringify(categoryPriority));
    } catch (e) {
        // localStorage may be unavailable (private mode); silently ignore
    }
}

function loadSavedCategoryPriority() {
    try {
        const saved = localStorage.getItem('categoryPriority');
        if (saved) {
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed)) categoryPriority = parsed;
        }
    } catch (e) {
        // ignore malformed storage
    }
}

// Graduation requirement targets: how many courses each category actually
// needs. Unset (undefined) means "however many are listed" — the dashboard's
// prior, purely-derived behavior.
let requirementTargets = {};

function persistRequirementTargets() {
    try {
        localStorage.setItem('requirementTargets', JSON.stringify(requirementTargets));
    } catch (e) {
        // localStorage may be unavailable (private mode); silently ignore
    }
}

function loadSavedRequirementTargets() {
    try {
        const saved = localStorage.getItem('requirementTargets');
        if (!saved) return;
        const parsed = JSON.parse(saved);
        requirementTargets = {};
        // Migrate from the earlier shape (category -> plain count number)
        // to category -> { count, units }.
        Object.keys(parsed).forEach(category => {
            const val = parsed[category];
            requirementTargets[category] = (typeof val === 'number') ? { count: val } : val;
        });
    } catch (e) {
        requirementTargets = {};
    }
}

function getCourseCategories(course) {
    const rawCategory = course.reqSatisfied || 'Required';
    return rawCategory.split(',').map(c => c.trim()).filter(c => c);
}

function incrementCategoryCounts(course, counts, unitCounts) {
    getCourseCategories(course).forEach(category => {
        counts[category] = (counts[category] || 0) + 1;
        if (unitCounts) unitCounts[category] = (unitCounts[category] || 0) + (course.units || 0);
    });
}

// A category is "met" only once every dimension it has a configured target
// for (course count and/or units) has been reached — and only if at least
// one dimension is actually configured.
function categoryTargetMet(category, categoryPlacedCounts, categoryPlacedUnits) {
    const target = requirementTargets[category];
    if (!target || (target.count == null && target.units == null)) return false;
    const countOk = target.count == null || (categoryPlacedCounts[category] || 0) >= target.count;
    const unitsOk = target.units == null || (categoryPlacedUnits[category] || 0) >= target.units;
    return countOk && unitsOk;
}

// A course still "helps" if at least one of its categories isn't fully met
// yet. Once every category a course satisfies is already at target,
// auto-plan skips it.
function courseHelpsUnmetCategory(course, categoryPlacedCounts, categoryPlacedUnits) {
    const categories = getCourseCategories(course);
    if (categories.length === 0) return true;
    return categories.some(category => !categoryTargetMet(category, categoryPlacedCounts, categoryPlacedUnits));
}

function getListedCategoryCounts() {
    const counts = {};
    ALL_CLASSES_DATA.forEach(course => {
        if (course.enabled === false) return;
        incrementCategoryCounts(course, counts);
    });
    return counts;
}

function getListedCategoryUnits() {
    const counts = {};
    const units = {};
    ALL_CLASSES_DATA.forEach(course => {
        if (course.enabled === false) return;
        incrementCategoryCounts(course, counts, units);
    });
    return units;
}

function loadRequirementTargetsUI() {
    const list = document.getElementById('requirementTargetsList');
    if (!list) return;

    const counts = getListedCategoryCounts();
    const unitCounts = getListedCategoryUnits();
    const categories = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));

    if (categories.length === 0) {
        list.innerHTML = '<li class="category-priority-empty">Load course data to see categories.</li>';
        return;
    }

    list.innerHTML = '';
    categories.forEach(category => {
        const li = document.createElement('li');
        li.className = 'requirement-target-item';

        const nameSpan = document.createElement('span');
        nameSpan.className = 'category-name';
        nameSpan.textContent = category;

        const hintSpan = document.createElement('span');
        hintSpan.className = 'requirement-target-hint';
        hintSpan.textContent = `${counts[category]} listed / ${unitCounts[category] || 0}u`;

        const target = requirementTargets[category] || {};

        const countField = document.createElement('div');
        countField.className = 'requirement-target-field';
        const countLabel = document.createElement('span');
        countLabel.textContent = 'Courses';
        const countInput = document.createElement('input');
        countInput.type = 'number';
        countInput.min = '0';
        countInput.className = 'requirement-target-input';
        countInput.placeholder = String(counts[category]);
        if (target.count != null) countInput.value = target.count;
        countField.appendChild(countLabel);
        countField.appendChild(countInput);

        const unitsField = document.createElement('div');
        unitsField.className = 'requirement-target-field';
        const unitsLabel = document.createElement('span');
        unitsLabel.textContent = 'Units';
        const unitsInput = document.createElement('input');
        unitsInput.type = 'number';
        unitsInput.min = '0';
        unitsInput.className = 'requirement-target-input';
        unitsInput.placeholder = String(unitCounts[category] || 0);
        if (target.units != null) unitsInput.value = target.units;
        unitsField.appendChild(unitsLabel);
        unitsField.appendChild(unitsInput);

        const commit = () => {
            const countVal = countInput.value.trim();
            const unitsVal = unitsInput.value.trim();
            const next = {};
            if (countVal !== '') next.count = Math.max(0, parseInt(countVal) || 0);
            if (unitsVal !== '') next.units = Math.max(0, parseInt(unitsVal) || 0);
            if (next.count == null && next.units == null) {
                delete requirementTargets[category];
            } else {
                requirementTargets[category] = next;
            }
            persistRequirementTargets();
            updateRequirementProgress();
        };
        countInput.onchange = commit;
        unitsInput.onchange = commit;

        li.appendChild(nameSpan);
        li.appendChild(hintSpan);
        li.appendChild(countField);
        li.appendChild(unitsField);
        list.appendChild(li);
    });
}

function checkPlanningFeasibility(academicQuarters, graph) {
    const unplacedNodes = Object.values(graph).filter(node => !node.placed);

    const unplacedRequiredUnits = unplacedNodes
        .reduce((sum, node) => sum + node.course.units, 0);

    const effectiveMaxUnits = getEffectiveMaxUnitsPerQuarter();
    const availableCapacity = academicQuarters.reduce(
        (sum, q) => sum + Math.max(0, effectiveMaxUnits - q.units),
        0
    );

    // A chain of N unplaced, prerequisite-linked courses needs at least N
    // separate quarters no matter how much unit budget is available —
    // dependencyDepth already measures each node's own remaining downstream
    // chain length, so the max over unplaced nodes is the binding constraint.
    const minQuartersForLongestChain = unplacedNodes.reduce(
        (max, node) => Math.max(max, node.dependencyDepth), 0
    );

    const unitsFeasible = unplacedRequiredUnits <= availableCapacity;
    const timelineFeasible = minQuartersForLongestChain <= academicQuarters.length;

    return {
        feasible: unitsFeasible && timelineFeasible,
        unplacedRequiredUnits,
        availableCapacity,
        shortfall: Math.max(0, unplacedRequiredUnits - availableCapacity),
        academicQuarterCount: academicQuarters.length,
        minQuartersForLongestChain,
        unitsFeasible,
        timelineFeasible
    };
}

function resetQuartersForPlanning() {
    const unassignedQuarter = getQuarterById('unassigned');
    if (!unassignedQuarter) {
        console.error("Unassigned quarter not found.");
        return null;
    }
    
    // Store courses from locked quarters and all pinned courses
    const lockedCoursesData = new Map();
    const pinnedCoursesData = new Map();
    
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned') {
            if (isQuarterLocked(quarter.id)) {
                // Store all courses in locked quarters
                lockedCoursesData.set(quarter.id, [...quarter.classes]);
            } else if (quarter.pinnedClasses.length > 0) {
                // Store pinned courses from unlocked quarters
                pinnedCoursesData.set(quarter.id, [...quarter.pinnedClasses]);
            }
        }
    });
    
    // Reset all courses to unassigned, but exclude courses in locked quarters
    const lockedCourseIds = new Set();
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned' && isQuarterLocked(quarter.id)) {
            quarter.classes.forEach(classId => lockedCourseIds.add(classId));
        }
    });
    
    unassignedQuarter.classes = ALL_CLASSES_DATA
        .filter(c => c.enabled !== false)
        .map(c => c.id)
        .filter(id => !lockedCourseIds.has(id));
    
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned' && !isQuarterLocked(quarter.id)) {
            // Only reset unlocked quarters
            quarter.classes = [];
            quarter.units = 0;
            // Keep pinnedClasses array but clear it for now
            quarter.pinnedClasses = [];
        } else if (quarter.id !== 'unassigned' && isQuarterLocked(quarter.id)) {
            // Keep locked quarters as-is, no need to clear since we preserve them
            // Just update their pinnedClasses to include all current courses
            quarter.pinnedClasses = [...quarter.classes];
        }
    });

    // Restore pinned courses to unlocked quarters
    pinnedCoursesData.forEach((pinnedClassIds, quarterId) => {
        const quarter = getQuarterById(quarterId);
        if (quarter && !isQuarterLocked(quarterId)) {
            pinnedClassIds.forEach(classId => {
                // Remove from unassigned
                unassignedQuarter.classes = unassignedQuarter.classes.filter(id => id !== classId);
                // Add back to unlocked quarter
                quarter.classes.push(classId);
                quarter.pinnedClasses.push(classId);
                
                // Update quarter stats
                const classData = findClassById(classId);
                if (classData) {
                    quarter.units += classData.units;
                }
            });
        }
    });

    return unassignedQuarter;
}

function getAcademicQuartersForPlanning() {
    return quartersData
        .filter(q => q.id !== 'unassigned' && !q.name.toLowerCase().includes('summer') && !isQuarterLocked(q.id))
        .sort((a, b) => getQuarterChronologicalOrder(a) - getQuarterChronologicalOrder(b));
}

function checkPrerequisitesSatisfied(courseNode, completedBeforeQuarter, graph) {
    return courseNode.prerequisites.every(entry =>
        isPrereqEntryMet(entry, completedBeforeQuarter, id => !!graph[id])
    );
}

function generateUnassignedReason(courseNode, academicQuarters, graph) {
    let prereqDetail = "";
    for (const entry of courseNode.prerequisites) {
        const alternatives = prereqAlternatives(entry);
        const inGraph = alternatives.filter(id => graph[id]);
        if (inGraph.length > 0 && !inGraph.some(id => graph[id].placed)) {
            prereqDetail = `Prereq. ${entry} not scheduled.`;
            break;
        }

        if (alternatives.every(id => !findClassById(id) && !graph[id])) {
            prereqDetail = `Prereq. ${entry} missing from data.`;
            break;
        }
    }

    if (prereqDetail) {
        return prereqDetail;
    }

    // Check if it's a capacity issue (units)
    const course = courseNode.course;
    let hasUnitsCapacity = false;

    // Summer and locked quarters aren't in academicQuarters; their courses
    // count as completed once the sweep passes them chronologically.
    const academicIds = new Set(academicQuarters.map(q => q.id));
    const otherQuarters = quartersData.filter(q => q.id !== 'unassigned' && !academicIds.has(q.id));
    let tempCompleted = new Set();

    // Check each quarter to see what's blocking placement
    for (const quarter of academicQuarters) {
        const order = getQuarterChronologicalOrder(quarter);
        otherQuarters.forEach(q => {
            if (getQuarterChronologicalOrder(q) < order) q.classes.forEach(c => tempCompleted.add(c));
        });
        // Check if prerequisites would be satisfied
        const prereqsSatisfied = checkPrerequisitesSatisfied(courseNode, tempCompleted, graph);

        if (prereqsSatisfied) {
            const wouldExceedUnits = quarter.units + course.units > getEffectiveMaxUnitsPerQuarter();

            if (!wouldExceedUnits) hasUnitsCapacity = true;
        }

        // Add this quarter's courses to completed for next iteration
        quarter.classes.forEach(c => tempCompleted.add(c));
    }

    if (!hasUnitsCapacity) {
        return "No term has room for it. Raise max units per term, or add a year.";
    }

    return "No suitable quarter (capacity/schedule).";
}

function finalizeUnassignedCourses(graph) {
    const unassignedQuarter = getQuarterById('unassigned');
    unassignedQuarter.classes = ALL_CLASSES_DATA
        .filter(c => c.enabled !== false)
        .map(c => c.id)
        .filter(id => {
            const courseData = findClassById(id);
            if (!courseData) return false;

            // Since all courses are now Required, we only need to check if they're placed
            if (graph[id]) {
                return !graph[id].placed;
            }
            return (courseData.category === "Required" || courseData.category === "Capstone" || courseData.category === "External");
        });
}

// Planner engine: 'optimal' solves the whole plan as an integer program with
// HiGHS (solver.js, in a Web Worker); 'heuristic' is the greedy sweep below.
// Optimal falls back to heuristic if the solver can't load or run.
let plannerEngine = 'optimal';
// Shown under the Auto Plan button: which engine ran and how long it took.
let lastPlanRun = null;
let solverWorker = null;
let solverRequestId = 0;
let planningInProgress = false;

const SOLVER_TIME_LIMIT_SECONDS = 10;
// Allowance for downloading the ~3 MB solver the first time
const SOLVER_LOAD_ALLOWANCE_MS = 20000;

function autoPlanCoreCourses() {
    if (planningInProgress) return;
    if (plannerEngine === 'optimal' && typeof Worker !== 'undefined') {
        planningInProgress = true;
        setAutoPlanBusy(true);
        return autoPlanOptimal()
            .catch(err => {
                console.warn('Optimal planner failed; using the heuristic planner instead.', err);
                const start = performance.now();
                autoPlanHeuristic();
                lastPlanRun = { engine: 'heuristic', ms: performance.now() - start, fallbackReason: err.message };
                renderPlanRunInfo();
            })
            .finally(() => {
                planningInProgress = false;
                setAutoPlanBusy(false);
            });
    }
    const start = typeof performance !== 'undefined' ? performance.now() : 0;
    autoPlanHeuristic();
    lastPlanRun = { engine: 'heuristic', ms: (typeof performance !== 'undefined' ? performance.now() : 0) - start };
    renderPlanRunInfo();
}

async function autoPlanOptimal() {
    const run = preparePlanningRun();
    if (!run) return;
    const problem = buildSolverProblem(run);

    let chosenRun = run;
    if (problem.courses.length > 0) {
        const result = await solveInWorker(problem);
        const settled = settleOptimalRun(run, problem, result.placements, result.status);
        chosenRun = settled.run;
        lastPlanRun = { engine: 'optimal', ms: result.ms, status: result.status, stats: result.stats,
            keptHeuristic: settled.keptHeuristic };
    } else {
        lastPlanRun = { engine: 'optimal', ms: 0, status: 'Nothing to place' };
    }

    finishPlanningRun(chosenRun);
    renderPlanRunInfo();
}

// Apply the solver's answer. If the solver stopped before proving it optimal
// (time limit on a slow device or a very over-full plan), its best-so-far can
// be worse than the quick planner's, so run that too and keep whichever
// leaves fewer required courses — then fewer courses — unplaced. Shared with
// the test suite.
function settleOptimalRun(run, problem, placements, status) {
    applySolverPlacements(run, problem, placements);
    if (status === 'Optimal') return { run, keptHeuristic: false };

    const solverScore = unplacedScore();
    const solverState = { quarters: JSON.parse(JSON.stringify(quartersData)), graph, run };

    const heuristicRun = planHeuristic();
    const heuristicScore = unplacedScore();
    const heuristicBetter = heuristicRun && (heuristicScore.required < solverScore.required ||
        (heuristicScore.required === solverScore.required && heuristicScore.total < solverScore.total));
    if (heuristicBetter) return { run: heuristicRun, keptHeuristic: true };

    quartersData = solverState.quarters;
    graph = solverState.graph;
    run.academicQuarters = run.academicQuarters.map(q => getQuarterById(q.id));
    return { run, keptHeuristic: false };
}

function unplacedScore() {
    const unplaced = Object.values(graph).filter(node => !node.placed);
    return { required: unplaced.filter(isRequiredCourse).length, total: unplaced.length };
}

// Put the solver's { courseId: quarterId } answer into the plan. Shared with
// the test suite, which runs the solver in Node instead of a Web Worker.
function applySolverPlacements(run, problem, placements) {
    problem.courses.forEach(course => {
        const quarterId = placements[course.id];
        if (!quarterId) return;
        const quarter = getQuarterById(quarterId);
        const node = graph[course.id];
        quarter.classes.push(course.id);
        quarter.units += node.course.units;
        node.placed = true;
        node.unassignedReason = '';
        incrementCategoryCounts(node.course, run.categoryPlacedCounts, run.categoryPlacedUnits);
    });
    // The solver plans whole-term combinations, so there are no per-quarter
    // runner-up lists like the heuristic produces.
    run.academicQuarters.forEach(q => { q.backupOptions = []; });
}

// Turn the prepared planning state into the plain problem solver.js expects.
function buildSolverProblem(run) {
    const relevant = id => !!graph[id];
    const terms = run.academicQuarters.map(q => ({
        id: q.id,
        order: getQuarterChronologicalOrder(q),
        fixedUnits: q.units,
        fixedDifficulty: q.classes.reduce((sum, id) => {
            const course = findClassById(id);
            return sum + (course ? getCourseDifficulty(course) : 0);
        }, 0)
    }));

    const fixed = {};
    const fixedCourses = [];
    quartersData.forEach(q => {
        if (q.id === 'unassigned') return;
        const order = getQuarterChronologicalOrder(q);
        q.classes.forEach(id => {
            if (!graph[id] || !graph[id].placed) return;
            fixed[id] = order;
            // Locked/summer courses are history; only pins in open terms
            // need their prerequisites scheduled first
            if (q.name.toLowerCase().includes('summer') || isQuarterLocked(q.id)) return;
            fixedCourses.push({
                id,
                order,
                prerequisites: graph[id].prerequisites.map(entry => prereqAlternatives(entry).filter(relevant))
            });
        });
    });

    const courses = Object.values(graph)
        .filter(node => !node.placed)
        .map(node => ({
            id: node.course.id,
            units: node.course.units || 0,
            difficulty: getCourseDifficulty(node.course),
            required: isRequiredCourse(node),
            score: run.scores.get(node.course.id) || 0,
            prerequisites: node.prerequisites.map(entry => prereqAlternatives(entry).filter(relevant)),
            corequisites: node.corequisites.filter(relevant),
            categories: getCourseCategories(node.course)
        }));

    // Room left under each graduation-requirement target after fixed courses
    const targets = {};
    Object.entries(requirementTargets).forEach(([category, target]) => {
        if (!target || (target.count == null && target.units == null)) return;
        targets[category] = {
            count: target.count != null ? target.count - (run.categoryPlacedCounts[category] || 0) : null,
            units: target.units != null ? target.units - (run.categoryPlacedUnits[category] || 0) : null
        };
    });

    const workload = getEffectiveWorkloadConfig();
    const maxUnits = getEffectiveMaxUnitsPerQuarter();
    return {
        terms,
        fixed,
        fixedCourses,
        courses,
        targets,
        config: {
            maxUnits,
            // Fastest mode packs terms up to the cap; Balanced aims for the
            // target load and only goes above it when that's the only way
            // to fit courses in.
            targetUnits: planningSpeed === 'fastest' ? maxUnits
                : Math.min(maxUnits, PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER || maxUnits),
            maxDifficulty: workload.MAX_DIFFICULTY_PER_QUARTER,
            overloadPenalty: 20,
            difficultyPenalty: workload.OVERLOAD_PENALTY_PER_UNIT
        }
    };
}

function solveInWorker(problem) {
    if (!solverWorker) {
        solverWorker = new Worker('solver-worker.js');
    }
    const id = ++solverRequestId;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            // A hung worker can't be cancelled mid-solve; start fresh next time
            solverWorker.terminate();
            solverWorker = null;
            reject(new Error('The optimal planner took too long.'));
        }, SOLVER_TIME_LIMIT_SECONDS * 1000 + SOLVER_LOAD_ALLOWANCE_MS);
        const onMessage = (event) => {
            if (event.data.id !== id) return;
            cleanup();
            if (event.data.ok) resolve(event.data);
            else reject(new Error(event.data.error || 'The optimal planner failed.'));
        };
        const onError = (event) => {
            cleanup();
            solverWorker = null;
            reject(new Error(event.message || 'The optimal planner could not load.'));
        };
        const cleanup = () => {
            clearTimeout(timer);
            if (solverWorker) {
                solverWorker.removeEventListener('message', onMessage);
                solverWorker.removeEventListener('error', onError);
            }
        };
        solverWorker.addEventListener('message', onMessage);
        solverWorker.addEventListener('error', onError);
        solverWorker.postMessage({ id, problem, timeLimitSeconds: SOLVER_TIME_LIMIT_SECONDS });
    });
}

function setAutoPlanBusy(busy) {
    const button = document.getElementById('autoPlanButton');
    if (!button) return;
    button.disabled = busy;
    button.textContent = busy ? 'Planning…' : 'Auto Plan Courses';
}

function renderPlanRunInfo() {
    const el = document.getElementById('planRunInfo');
    if (!el || !lastPlanRun) return;
    const ms = Math.max(1, Math.round(lastPlanRun.ms || 0));
    if (lastPlanRun.engine === 'optimal' && lastPlanRun.keptHeuristic) {
        el.textContent = `Optimal planner ran out of time (${ms} ms); kept the quick planner's better plan`;
    } else if (lastPlanRun.engine === 'optimal') {
        const proven = lastPlanRun.status === 'Optimal' ? 'optimal plan' : 'best plan found';
        el.textContent = `Optimal planner · ${proven} in ${ms} ms`;
    } else if (lastPlanRun.fallbackReason) {
        el.textContent = `Heuristic planner (optimal planner unavailable: ${lastPlanRun.fallbackReason}) · ${ms} ms`;
    } else {
        el.textContent = `Heuristic planner · ${ms} ms`;
    }
    el.hidden = false;
}

// Shared setup for both planners: reset unpinned courses, build the graph,
// mark summer/locked/pinned courses as placed, check feasibility, and score
// every course still to place. Returns null if the planner can't run.
function preparePlanningRun() {
    const unassignedQuarter = resetQuartersForPlanning();
    if (!unassignedQuarter) return null;
    // Locks and pins may have changed since the automatic units were computed
    applyAutomaticUnitSettings();
    syncMaxUnitsQuick();

    syncCategoryPriorityWithData();
    const requirementWeights = deriveRequirementWeights();

    graph = initializePlanningGraph();
    const academicQuarters = getAcademicQuartersForPlanning();

    // Tracks how many courses/units per category are already placed, so the
    // planner stops scheduling more once a configured graduation-requirement
    // target (Advanced Settings) is met, rather than planning every listed
    // course in that category.
    const categoryPlacedCounts = {};
    const categoryPlacedUnits = {};

    // Summer + locked + pinned courses are pre-placed. Summer and locked
    // courses only count as completed for quarters chronologically after
    // their own (see the quarter loop below) — otherwise a course in Summer
    // Year 3 would satisfy prerequisites for Fall Year 1.
    const completed = new Set();
    const fixedQuarters = quartersData.filter(q =>
        q.id !== 'unassigned' &&
        (q.name.toLowerCase().includes('summer') || isQuarterLocked(q.id))
    );
    fixedQuarters.forEach(q => q.classes.forEach(id => {
        if (graph[id]) {
            graph[id].placed = true;
            incrementCategoryCounts(graph[id].course, categoryPlacedCounts, categoryPlacedUnits);
        }
    }));
    const addFixedCoursesBefore = (order) => fixedQuarters.forEach(q => {
        if (getQuarterChronologicalOrder(q) < order) q.classes.forEach(id => completed.add(id));
    });
    academicQuarters.forEach(q => {
        q.pinnedClasses.forEach(id => {
            if (graph[id]) {
                graph[id].placed = true;
                incrementCategoryCounts(graph[id].course, categoryPlacedCounts, categoryPlacedUnits);
            }
        });
    });

    const feasibility = checkPlanningFeasibility(academicQuarters, graph);
    // Compute priority scores once — they depend only on graph structure,
    // not on where courses end up.
    const scores = new Map();
    Object.values(graph).forEach(node => {
        if (!node.placed) {
            scores.set(node.course.id, computePriorityScore(node, graph, requirementWeights));
        }
    });

    const neededPrereqs = computeNeededPrerequisites(graph, categoryPlacedCounts, categoryPlacedUnits);

    return {
        academicQuarters, addFixedCoursesBefore, completed,
        categoryPlacedCounts, categoryPlacedUnits, scores, feasibility, neededPrereqs
    };
}

// Heuristic planner: greedy quarter-by-quarter sweep. Used when the optimal
// planner is turned off or unavailable.
function autoPlanHeuristic() {
    const run = planHeuristic();
    if (run) finishPlanningRun(run);
}

// The sweep itself, without the wrap-up, so its result can be compared with
// the solver's before either is shown.
function planHeuristic() {
    const run = preparePlanningRun();
    if (!run) return null;
    const { academicQuarters, addFixedCoursesBefore, completed,
        categoryPlacedCounts, categoryPlacedUnits, scores, neededPrereqs } = run;

    // A pinned/fixed course's prerequisites (transitively) must land strictly
    // before it. deadlineOrder[id] = earliest chronological order of any
    // pre-placed course that depends on id.
    // Courses in locked or summer terms are history (already taken), so they
    // don't constrain anything; and a deadline no open term can meet is
    // dropped rather than leaving the prerequisite (and its chain) unplaced.
    const deadlineOrder = {};
    const firstOpenOrder = academicQuarters.length > 0
        ? getQuarterChronologicalOrder(academicQuarters[0]) : Infinity;
    quartersData.forEach(q => {
        if (q.id === 'unassigned' || q.name.toLowerCase().includes('summer') || isQuarterLocked(q.id)) return;
        const order = getQuarterChronologicalOrder(q);
        const stack = q.classes.filter(id => graph[id] && graph[id].placed);
        const seen = new Set();
        while (stack.length > 0) {
            const node = graph[stack.pop()];
            if (!node) continue;
            // Only single-course entries force a deadline; in an OR-group no
            // individual alternative is required.
            node.prerequisites.filter(entry => prereqAlternatives(entry).length === 1).forEach(prereqId => {
                if (seen.has(prereqId)) return;
                seen.add(prereqId);
                if (order > firstOpenOrder) {
                    deadlineOrder[prereqId] = Math.min(deadlineOrder[prereqId] ?? Infinity, order);
                }
                stack.push(prereqId);
            });
        }
    });

    // Quarter-by-quarter combination selection per spec §"Course Selection
    // Algorithm": for each quarter, find eligible courses, generate unit-
    // feasible combinations, validate coreqs at the combination level, and
    // place the highest-scoring valid combination.
    for (const quarter of academicQuarters) {
        addFixedCoursesBefore(getQuarterChronologicalOrder(quarter));
        const remainingBudget = getEffectiveMaxUnitsPerQuarter() - quarter.units;
        if (remainingBudget <= 0) {
            quarter.backupOptions = [];
            quarter.classes.forEach(id => completed.add(id));
            continue;
        }

        const eligible = Object.values(graph)
            .filter(node => !node.placed && !completed.has(node.course.id))
            .filter(node => checkPrerequisitesSatisfied(node, completed, graph))
            .filter(node => getQuarterChronologicalOrder(quarter) < (deadlineOrder[node.course.id] ?? Infinity))
            .filter(node => neededPrereqs.has(node.course.id) ||
                courseHelpsUnmetCategory(node.course, categoryPlacedCounts, categoryPlacedUnits))
            .sort((a, b) => scores.get(b.course.id) - scores.get(a.course.id));

        if (eligible.length === 0) {
            quarter.backupOptions = [];
            quarter.classes.forEach(id => completed.add(id));
            continue;
        }

        const combos = generateUnitFeasibleCombinations(eligible, remainingBudget);
        const validCombos = combos
            .filter(combo => combinationCoreqsSatisfied(combo, completed, quarter))
            .filter(combo => comboRespectsCategoryTargets(combo, categoryPlacedCounts, categoryPlacedUnits, neededPrereqs));

        let bestCombo = [];
        let bestScore = -Infinity;
        for (const combo of validCombos) {
            const comboScore = scoreCombination(combo, quarter, scores);
            if (comboScore > bestScore) {
                bestScore = comboScore;
                bestCombo = combo;
            }
        }

        for (const node of bestCombo) {
            quarter.classes.push(node.course.id);
            node.placed = true;
            quarter.units += node.course.units;
            node.unassignedReason = '';
            incrementCategoryCounts(node.course, categoryPlacedCounts, categoryPlacedUnits);
        }

        // Backups: highest-scoring eligible courses that didn't make the cut
        // this quarter — surfaced in the UI as "next best" alternatives.
        const bestComboIds = new Set(bestCombo.map(node => node.course.id));
        quarter.backupOptions = eligible
            .filter(node => !bestComboIds.has(node.course.id))
            .slice(0, 3)
            .map(node => ({ id: node.course.id, name: node.course.name || node.course.id }));

        quarter.classes.forEach(id => completed.add(id));
    }

    return run;
}

// Shared wrap-up: drop courses beyond the graduation targets, explain every
// course left unassigned, then re-render.
function finishPlanningRun(run) {
    pruneCoursesBeyondTargets(run);
    const { academicQuarters, categoryPlacedCounts, categoryPlacedUnits } = run;

    // Courses left over solely because their category already hit its
    // configured target get a specific reason, ahead of the generic pass.
    Object.values(graph).forEach(node => {
        if (!node.placed && !(run.neededPrereqs && run.neededPrereqs.has(node.course.id)) &&
            !courseHelpsUnmetCategory(node.course, categoryPlacedCounts, categoryPlacedUnits)) {
            const metCategories = getCourseCategories(node.course)
                .filter(cat => requirementTargets[cat] != null)
                .map(cat => {
                    const target = requirementTargets[cat];
                    if (target.units != null) {
                        return `${cat} (${categoryPlacedUnits[cat] || 0}/${target.units}u)`;
                    }
                    return `${cat} (${categoryPlacedCounts[cat] || 0}/${target.count})`;
                });
            node.unassignedReason = `Not needed — requirement already met: ${metCategories.join(', ')}.`;
        }
    });

    // Any course still unplaced after the quarter sweep: generate a reason.
    Object.values(graph).forEach(node => {
        if (!node.placed && !node.unassignedReason) {
            node.unassignedReason = generateUnassignedReason(node, academicQuarters, graph);
        }
    });

    finalizeUnassignedCourses(graph);
    renderPlanner();
    reportPlanOutcome(run);
}

// Coreqs are satisfied if each course's coreqs are already completed, already
// in this quarter (pinned), or also in the proposed combination.
function combinationCoreqsSatisfied(combo, completed, quarter) {
    const inCombo = new Set([...combo.map(n => n.course.id), ...quarter.classes]);
    return combo.every(node =>
        node.corequisites.every(coreqId =>
            completed.has(coreqId) || inCombo.has(coreqId) || !graph[coreqId]
        )
    );
}

// Graduation targets limit which courses are worth planning: a course is
// worth adding only while at least one of its categories still needs more
// (or it's a prerequisite of a course that does). Courses are checked in
// combination order with counts updated as they're added, so several
// courses for the same requirement can't overshoot it within one term. A
// course that counts toward a met category AND an unmet one is allowed:
// e.g. "ST, Stats & DS Minor" when ST still needs courses but the minor's
// target is 0.
function comboRespectsCategoryTargets(combo, categoryPlacedCounts, categoryPlacedUnits, neededPrereqs) {
    const counts = { ...categoryPlacedCounts };
    const units = { ...categoryPlacedUnits };
    for (const node of combo) {
        const needed = (neededPrereqs && neededPrereqs.has(node.course.id)) ||
            courseHelpsUnmetCategory(node.course, counts, units);
        if (!needed) return false;
        incrementCategoryCounts(node.course, counts, units);
    }
    return true;
}

// Courses placed as prerequisites also count toward their own categories,
// so a plan can end up over a target (e.g. 7 electives when 5 are needed).
// Remove planned courses, latest first, while every one of their categories
// stays at or above target and no placed course depends on them. Pinned,
// locked, and summer courses are never removed.
function pruneCoursesBeyondTargets(run) {
    const hasTarget = k => requirementTargets[k] &&
        (requirementTargets[k].count != null || requirementTargets[k].units != null);
    if (!Object.keys(requirementTargets).some(hasTarget)) return;

    const recount = () => {
        const counts = {};
        const units = {};
        Object.values(graph).forEach(node => {
            if (node.placed) incrementCategoryCounts(node.course, counts, units);
        });
        return { counts, units };
    };
    let { counts, units } = recount();

    const removable = (node, quarter) => {
        const categories = getCourseCategories(node.course);
        if (!categories.every(hasTarget)) return false;
        if (quarter.pinnedClasses && quarter.pinnedClasses.includes(node.course.id)) return false;
        const needed = Object.values(graph).some(other =>
            other.placed && allPrereqIds(other.course).includes(node.course.id));
        if (needed) return false;
        return categories.every(k => {
            const t = requirementTargets[k];
            const countOk = t.count == null || (counts[k] || 0) - 1 >= t.count;
            const unitsOk = t.units == null || (units[k] || 0) - (node.course.units || 0) >= t.units;
            return countOk && unitsOk;
        });
    };

    let changed = true;
    while (changed) {
        changed = false;
        const candidates = run.academicQuarters
            .slice()
            .sort((a, b) => getQuarterChronologicalOrder(b) - getQuarterChronologicalOrder(a))
            .flatMap(q => q.classes.map(id => [graph[id], q]))
            .filter(([node]) => node && node.placed);
        for (const [node, quarter] of candidates) {
            if (!removable(node, quarter)) continue;
            quarter.classes = quarter.classes.filter(id => id !== node.course.id);
            quarter.units -= node.course.units || 0;
            getQuarterById('unassigned').classes.push(node.course.id);
            node.placed = false;
            ({ counts, units } = recount());
            changed = true;
            break;
        }
    }
    run.categoryPlacedCounts = counts;
    run.categoryPlacedUnits = units;
}

// Courses that must be planned because a still-needed course depends on
// them (transitively), even if their own categories' targets are met.
function computeNeededPrerequisites(graph, categoryPlacedCounts, categoryPlacedUnits) {
    const needed = new Set();
    const stack = Object.values(graph)
        .filter(node => !node.placed && courseHelpsUnmetCategory(node.course, categoryPlacedCounts, categoryPlacedUnits))
        .map(node => node.course.id);
    while (stack.length > 0) {
        const node = graph[stack.pop()];
        if (!node) continue;
        node.prerequisites.flatMap(prereqAlternatives).forEach(id => {
            if (graph[id] && !graph[id].placed && !needed.has(id)) {
                needed.add(id);
                stack.push(id);
            }
        });
    }
    return needed;
}

// ----- Share links -----
// The whole course list and plan are packed into the URL after "#plan=", so a
// plan can move between devices or go to an advisor with no account or
// server. The part after "#" is never sent to the web server.
const SHARE_PREFIX = '#plan=';

async function sharePlan() {
    if (ALL_CLASSES_DATA.length === 0) {
        showPlanStatus('Load a course list before sharing.', 'error');
        return;
    }
    let link;
    try {
        link = await buildShareLink();
    } catch (e) {
        showPlanStatus(`Couldn't create a share link: ${e.message}`, 'error');
        return;
    }
    let copied = false;
    try {
        await navigator.clipboard.writeText(link);
        copied = true;
    } catch (e) {
        // Clipboard can be blocked; the link is shown for manual copying
    }
    const field = document.createElement('input');
    field.type = 'text';
    field.readOnly = true;
    field.value = link;
    field.className = 'share-link-field';
    field.setAttribute('aria-label', 'Share link');
    field.addEventListener('focus', () => field.select());
    showPlanStatus(copied
        ? 'Share link copied. Anyone with the link can open a copy of this plan; no account needed.'
        : 'Copy this link to share the plan. Anyone with it can open a copy.', 'success', [], field);
    if (!copied) field.focus();
}

async function buildShareLink() {
    const index = new Map(ALL_CLASSES_DATA.map((c, i) => [c.id, i]));
    const toIndexes = ids => (ids || []).map(id => index.get(id)).filter(i => i != null);
    const override = key => PLANNING_CONFIG.overrides[key] ? PLANNING_CONFIG[key] : null;
    const state = {
        v: 1,
        s: {
            system: currentAcademicSystem,
            timeline: { ...dynamicSettings },
            speed: planningSpeed,
            units: {
                max: override('MAX_UNITS_PER_QUARTER'),
                min: override('MIN_UNITS_PER_QUARTER'),
                target: override('TARGET_UNITS_PER_QUARTER')
            }
        },
        // [id, name (0 = same as id), prereqs, coreqs, description, units,
        //  difficulty, requirement, taken, enabled, color]
        c: ALL_CLASSES_DATA.map(c => [
            c.id, c.name !== c.id ? c.name : 0, c.prerequisites, c.corequisites, c.description || '',
            c.units, getCourseDifficulty(c), c.reqSatisfied || '', c.taken || '',
            c.enabled === false ? 0 : 1, c.color || 0
        ]),
        // [quarter id, course indexes, pinned indexes, pins added by a lock]
        q: quartersData
            .filter(q => q.id !== 'unassigned' && q.classes.length > 0)
            .map(q => [q.id, toIndexes(q.classes), toIndexes(q.pinnedClasses), toIndexes(q.lockAddedPins)]),
        l: [...lockedQuarters],
        t: requirementTargets,
        p: categoryPriority
    };
    const payload = await encodeSharePayload(JSON.stringify(state));
    return `${location.origin}${location.pathname}${SHARE_PREFIX}${payload}`;
}

// "z" + base64url(deflate(json)) where the browser can compress, otherwise
// "j" + base64url(json).
async function encodeSharePayload(text) {
    const bytes = new TextEncoder().encode(text);
    if (typeof CompressionStream === 'undefined') return 'j' + toBase64Url(bytes);
    const stream = new CompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    // A failure (e.g. a damaged link) surfaces when reading below; these
    // promises reject too, so mark them handled.
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    return 'z' + toBase64Url(new Uint8Array(await new Response(stream.readable).arrayBuffer()));
}

async function decodeSharePayload(payload) {
    const bytes = fromBase64Url(payload.slice(1));
    if (payload[0] === 'j') return new TextDecoder().decode(bytes);
    if (payload[0] !== 'z') throw new Error('Unknown share link format');
    const stream = new DecompressionStream('deflate-raw');
    const writer = stream.writable.getWriter();
    // A failure (e.g. a damaged link) surfaces when reading below; these
    // promises reject too, so mark them handled.
    writer.write(bytes).catch(() => {});
    writer.close().catch(() => {});
    return new TextDecoder().decode(await new Response(stream.readable).arrayBuffer());
}

function toBase64Url(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text) {
    const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - base64.length % 4) % 4));
    return Uint8Array.from(binary, ch => ch.charCodeAt(0));
}

// Replace the current course list, plan, and planning settings with a
// shared one, and save it in this browser.
function applySharedState(state) {
    const settings = state.s || {};
    if (settings.system === 'quarter' || settings.system === 'semester') currentAcademicSystem = settings.system;
    if (settings.timeline) Object.assign(dynamicSettings, settings.timeline);
    if (settings.speed === 'balanced' || settings.speed === 'fastest') planningSpeed = settings.speed;
    const units = settings.units || {};
    [['max', 'MAX_UNITS_PER_QUARTER'], ['min', 'MIN_UNITS_PER_QUARTER'], ['target', 'TARGET_UNITS_PER_QUARTER']]
        .forEach(([key, configKey]) => {
            const value = units[key];
            PLANNING_CONFIG.overrides[configKey] = value != null;
            if (value != null) PLANNING_CONFIG[configKey] = value;
        });

    ALL_CLASSES_DATA = state.c.map((row, i) => ({
        id: row[0],
        name: row[1] || row[0],
        prerequisites: row[2] || [],
        corequisites: row[3] || [],
        description: row[4] || '',
        units: row[5] || 0,
        difficulty: row[6] ?? row[5] ?? 0,
        reqSatisfied: row[7] || 'Required',
        category: 'Required',
        taken: row[8] || '',
        planned: '',
        enabled: row[9] !== 0,
        originalOrder: i,
        ...(row[10] ? { color: row[10] } : {})
    }));

    pinnedCourses = new Set();
    lockedQuarters = new Set();
    initializeQuarters();
    const unassigned = getQuarterById('unassigned');
    const ids = indexes => (indexes || []).map(i => state.c[i] && state.c[i][0]).filter(Boolean);
    (state.q || []).forEach(([quarterId, classIdx, pinnedIdx, lockPinIdx]) => {
        const quarter = getQuarterById(quarterId);
        if (!quarter) return;
        const classes = ids(classIdx).filter(id => unassigned.classes.includes(id));
        quarter.classes = classes;
        quarter.pinnedClasses = ids(pinnedIdx).filter(id => classes.includes(id));
        quarter.lockAddedPins = ids(lockPinIdx).filter(id => classes.includes(id));
        quarter.units = classes.reduce((sum, id) => sum + (findClassById(id).units || 0), 0);
        quarter.pinnedClasses.forEach(id => pinnedCourses.add(id));
        unassigned.classes = unassigned.classes.filter(id => !classes.includes(id));
    });
    (state.l || []).forEach(id => { if (getQuarterById(id)) lockedQuarters.add(id); });
    requirementTargets = state.t || {};
    categoryPriority = Array.isArray(state.p) ? state.p : [];

    try {
        localStorage.setItem('academicSystem', currentAcademicSystem);
        localStorage.setItem('planningSpeed', planningSpeed);
    } catch (e) { /* storage unavailable */ }
    persistRequirementTargets();
    persistCategoryPriority();
    syncTimelineControls();
    updateDynamicSettings();
    graph = {};
    renderPlanner();
    setDataSource('Shared plan');
}

// Opening a share link: load it, but ask first if this browser already has
// a different plan saved.
async function handleSharedLinkOnLoad() {
    if (!location.hash.startsWith(SHARE_PREFIX)) return;
    const payload = location.hash.slice(SHARE_PREFIX.length);
    // Clear the address bar so a reload doesn't re-open the shared plan
    history.replaceState(null, '', location.pathname + location.search);

    let state;
    try {
        state = JSON.parse(await decodeSharePayload(payload));
        if (state.v !== 1 || !Array.isArray(state.c)) throw new Error('unsupported');
    } catch (e) {
        showPlanStatus("This share link is incomplete or damaged, so it couldn't be opened. Ask for a new link.", 'error');
        return;
    }

    const count = state.c.length;
    const open = () => {
        applySharedState(state);
        showPlanStatus(`Opened a shared plan with ${count} courses. It's now saved in this browser.`, 'success');
    };
    if (ALL_CLASSES_DATA.length > 0) {
        showPlanStatus(`This link has a shared plan with ${count} courses. Opening it replaces the plan saved in this browser.`,
            'warning', [{ label: 'Open shared plan', onClick: open }, { label: 'Keep my plan', onClick: clearPlanStatus }]);
    } else {
        open();
    }
}

function toggleSidebar() {
    const sidebar = document.getElementById('instructionsSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    const open = !sidebar.classList.contains('open');
    sidebar.classList.toggle('open', open);
    overlay.classList.toggle('active', open);
    // Keep the off-screen panel out of keyboard and screen-reader reach
    sidebar.inert = !open;
    if (open) sidebar.querySelector('.sidebar-close').focus();
}

function downloadPlan() {
    if (!ALL_CLASSES_DATA || ALL_CLASSES_DATA.length === 0) {
        showPlanStatus('Load a course list before exporting.', 'error');
        return;
    }

    // Taken holds only courses you took (they lock their term on import);
    // everything else in the plan goes to Planned, which re-imports without
    // locking anything.
    let csvContent = "Taken,Planned,Req Satisfied,Course Number,Prerequisites,Corequisites,Description,Units,Difficulty\n";

    ALL_CLASSES_DATA.forEach(courseData => {
        const courseQuarter = quartersData.find(q => q.classes.includes(courseData.id));
        const placed = courseQuarter && courseQuarter.id !== 'unassigned';
        const wasTaken = !!(courseData.taken && parseQuarterFromTaken(courseData.taken));

        let takenValue = 'Not Assigned';
        let plannedValue = '';
        if (wasTaken) {
            // Keep the course's current term in case it was moved since
            takenValue = placed ? formatQuarterForTaken(courseQuarter.name) : courseData.taken;
        } else if (placed) {
            plannedValue = formatQuarterForTaken(courseQuarter.name);
        }

        // Format prerequisites
        const prerequisites = courseData.prerequisites.length > 0 ? courseData.prerequisites.join(', ') : 'None';

        // Format corequisites
        const corequisites = courseData.corequisites.length > 0 ? courseData.corequisites.join(', ') : 'None';

        const reqSatisfied = courseData.reqSatisfied || 'Required';

        // Every field is quoted with embedded quotes doubled, so commas and
        // line breaks survive a re-import. Course Number is the id (not the
        // display name) because other rows' prerequisites reference the id.
        const csvField = value => `"${String(value ?? '').replace(/"/g, '""')}"`;
        csvContent += [takenValue, plannedValue, reqSatisfied, courseData.id, prerequisites, corequisites,
            courseData.description || '', courseData.units, getCourseDifficulty(courseData)].map(csvField).join(',') + '\n';
    });
    
    // Create and download the file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');

    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `course_plan_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } else {
        showPlanStatus("This browser can't download files. Try a different browser.", 'error');
    }
}

function formatQuarterForTaken(quarterName) {
    // Convert "Fall Year 1" to "Fall, Year 1"
    const match = quarterName.match(/^(Fall|Winter|Spring|Summer)\s+Year\s+(\d+)$/i);
    if (match) {
        return `${match[1]}, Year ${match[2]}`;
    }
    return quarterName; // Fallback to original name
}

// Courses with a Taken term are placed and pinned there, and their term is
// locked: Auto Plan treats it as done and adds nothing to it. (Unlocking a
// term later keeps the Taken courses pinned.)
function processTakenCourses() {
    ALL_CLASSES_DATA.forEach(courseData => {
        if (courseData.enabled === false || !courseData.taken) return;
        // Already placed (e.g. kept from the previous plan): leave it there
        if (quartersData.some(q => q.id !== 'unassigned' && q.classes.includes(courseData.id))) return;

        const quarterId = parseQuarterFromTaken(courseData.taken);
        // A term outside the timeline (e.g. "Fall, Year 5" in a 3-year plan)
        // leaves the course in Unassigned rather than making it vanish.
        const targetQuarter = quarterId && getQuarterById(quarterId);
        if (!targetQuarter) return;

        const unassignedQuarter = getQuarterById('unassigned');
        if (unassignedQuarter) {
            unassignedQuarter.classes = unassignedQuarter.classes.filter(id => id !== courseData.id);
        }
        targetQuarter.classes.push(courseData.id);
        targetQuarter.pinnedClasses.push(courseData.id);
        targetQuarter.units += courseData.units;
        pinnedCourses.add(courseData.id);
        lockedQuarters.add(targetQuarter.id);
    });
}

// Put courses back where an exported plan had them (the Planned column).
// Unlike Taken, these aren't pinned or locked, so Auto Plan can still move
// them. Planned values pointing at a locked or missing term are ignored.
function processPlannedCourses() {
    const unassignedQuarter = getQuarterById('unassigned');
    ALL_CLASSES_DATA.forEach(courseData => {
        if (courseData.enabled === false || !courseData.planned) return;
        if (quartersData.some(q => q.id !== 'unassigned' && q.classes.includes(courseData.id))) return;
        const quarterId = parseQuarterFromTaken(courseData.planned);
        const quarter = quarterId && getQuarterById(quarterId);
        if (!quarter || isQuarterLocked(quarter.id)) return;
        if (unassignedQuarter) {
            unassignedQuarter.classes = unassignedQuarter.classes.filter(id => id !== courseData.id);
        }
        quarter.classes.push(courseData.id);
        quarter.units += courseData.units;
    });
}

function parseQuarterFromTaken(takenValue) {
    // Parse format like "Fall, Year 1" or "Winter, Year 2"
    const match = takenValue.match(/^(Fall|Winter|Spring|Summer),?\s*Year\s*(\d+)$/i);
    if (match) {
        const season = match[1].toLowerCase();
        const year = parseInt(match[2]);
        const result = `${season}${year}`;
        return result;
    }
    
    // Also try format like "Fall Year 1" (without comma)
    const match2 = takenValue.match(/^(Fall|Winter|Spring|Summer)\s+Year\s*(\d+)$/i);
    if (match2) {
        const season = match2[1].toLowerCase();
        const year = parseInt(match2[2]);
        const result = `${season}${year}`;
        return result;
    }
    return null; // Invalid format
}

function pinCourse(classId, quarterId) {
    // Remove from current location
    quartersData.forEach(quarter => {
        quarter.classes = quarter.classes.filter(id => id !== classId);
        quarter.pinnedClasses = quarter.pinnedClasses.filter(id => id !== classId);
    });
    
    // Add to target quarter as pinned
    const targetQuarter = getQuarterById(quarterId);
    if (targetQuarter && quarterId !== 'unassigned') {
        targetQuarter.classes.push(classId);
        targetQuarter.pinnedClasses.push(classId);
        pinnedCourses.add(classId);
    }

    updateAllUnitCounts();
    validateAllPrerequisites();
    renderPlanner();
}

function unpinCourse(classId) {
    pinnedCourses.delete(classId);
    quartersData.forEach(quarter => {
        quarter.pinnedClasses = quarter.pinnedClasses.filter(id => id !== classId);
    });
    renderPlanner();
}

function isPinnedCourse(classId) {
    // Check if course is explicitly pinned
    if (pinnedCourses.has(classId)) {
        return true;
    }
    
    // Check if course is in a locked quarter
    return quartersData.some(quarter => 
        quarter.id !== 'unassigned' && 
        isQuarterLocked(quarter.id) && 
        quarter.classes.includes(classId)
    );
}

function getQuarterPinnedCourses(quarterId) {
    const quarter = getQuarterById(quarterId);
    return quarter ? quarter.pinnedClasses : [];
}

function lockQuarter(quarterId) {
    if (quarterId === 'unassigned') return; // Can't lock unassigned section
    
    const quarter = getQuarterById(quarterId);
    if (!quarter) return;
    
    // Check if any courses in the quarter are invalid
    const hasInvalidCourses = quarter.classes.some(classId => {
        const cardElement = document.getElementById(`class-${classId.replace(/\s+/g, '-')}`);
        return cardElement && cardElement.classList.contains('invalid');
    });
    
    if (hasInvalidCourses) {
        showPlanStatus("Can't lock this term: some of its courses are missing prerequisites (shown in red).", 'error');
        return;
    }
    
    // Pin all courses in the quarter, remembering which pins the lock added
    // so unlocking doesn't remove pins the user set individually.
    quarter.lockAddedPins = [];
    quarter.classes.forEach(classId => {
        if (!quarter.pinnedClasses.includes(classId)) {
            quarter.pinnedClasses.push(classId);
            pinnedCourses.add(classId);
            quarter.lockAddedPins.push(classId);
        }
    });
    
    lockedQuarters.add(quarterId);
    renderPlanner();
}

function unlockQuarter(quarterId) {
    if (quarterId === 'unassigned') return; // Can't unlock unassigned section
    
    const quarter = getQuarterById(quarterId);
    if (!quarter) return;
    
    // Unpin only the courses the lock itself pinned
    (quarter.lockAddedPins || []).forEach(classId => {
        quarter.pinnedClasses = quarter.pinnedClasses.filter(id => id !== classId);
        pinnedCourses.delete(classId);
    });
    quarter.lockAddedPins = [];
    
    lockedQuarters.delete(quarterId);
    renderPlanner();
}

function isQuarterLocked(quarterId) {
    return lockedQuarters.has(quarterId);
}

function toggleQuarterLock(quarterId) {
    if (isQuarterLocked(quarterId)) {
        unlockQuarter(quarterId);
    } else {
        lockQuarter(quarterId);
    }
}

function switchTab(tabName) {
    // Update tab buttons
    document.querySelectorAll('.tab-button').forEach(btn => btn.classList.remove('active'));
    document.getElementById(tabName + 'Tab').classList.add('active');
    
    // Update tab panels
    document.querySelectorAll('.tab-panel').forEach(panel => panel.classList.remove('active'));
    document.getElementById(tabName + 'TabContent').classList.add('active');
}

// Add drag and drop functionality
// Settings Modal Functions
function toggleSettingsModal() {
    const overlay = document.getElementById('settingsModalOverlay');
    if (overlay.classList.contains('active')) {
        closeSettingsModal();
    } else {
        openSettingsModal();
    }
}

function openSettingsModal() {
    const overlay = document.getElementById('settingsModalOverlay');
    overlay.classList.add('active');

    // Load current settings into the form
    loadCurrentSettings();
    loadCategoryPriorityUI();
    loadRequirementTargetsUI();
}

function closeSettingsModal() {
    const overlay = document.getElementById('settingsModalOverlay');
    overlay.classList.remove('active');
}

function loadCurrentSettings() {
    // Load academic system in main UI
    const academicSystemSelect = getElementByIdWithFallback('academicSystemNew', 'academicSystemMain');
    if (academicSystemSelect) {
        academicSystemSelect.value = currentAcademicSystem;
    }

    // Show overridden values; blank means automatic (shown as placeholder).
    // Max units lives in the toolbar.
    const minUnitsInput = document.getElementById('minUnits');
    const targetUnitsInput = document.getElementById('targetUnits');
    minUnitsInput.placeholder = `Auto (${PLANNING_CONFIG.MIN_UNITS_PER_QUARTER})`;
    targetUnitsInput.placeholder = `Auto (${PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER})`;
    document.getElementById('settingsError').style.display = 'none';

    minUnitsInput.value = PLANNING_CONFIG.overrides.MIN_UNITS_PER_QUARTER ?
        PLANNING_CONFIG.MIN_UNITS_PER_QUARTER : '';
    targetUnitsInput.value = PLANNING_CONFIG.overrides.TARGET_UNITS_PER_QUARTER ?
        PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER : '';

    const speedRadio = document.querySelector(`input[name="planningSpeed"][value="${planningSpeed}"]`);
    if (speedRadio) speedRadio.checked = true;
    const engineRadio = document.querySelector(`input[name="plannerEngine"][value="${plannerEngine}"]`);
    if (engineRadio) engineRadio.checked = true;
    updatePlanningSpeedToggleUI();
}

function updatePlanningSpeedToggleUI() {
    document.querySelectorAll('.speed-option').forEach(option => {
        const radio = option.querySelector('input[type="radio"]');
        option.classList.toggle('active', !!(radio && radio.checked));
    });
}

function saveSettings() {
    // Get values from advanced settings (max units is set in the toolbar)
    const minUnitsInput = document.getElementById('minUnits');
    const targetUnitsInput = document.getElementById('targetUnits');

    // Update overrides and values
    const newConfig = {};
    const newOverrides = {};

    // Min Units
    if (minUnitsInput.value.trim() !== '') {
        newConfig.MIN_UNITS_PER_QUARTER = parseInt(minUnitsInput.value);
        newOverrides.MIN_UNITS_PER_QUARTER = true;
    } else {
        newOverrides.MIN_UNITS_PER_QUARTER = false;
    }

    // Target Units
    if (targetUnitsInput.value.trim() !== '') {
        newConfig.TARGET_UNITS_PER_QUARTER = parseInt(targetUnitsInput.value);
        newOverrides.TARGET_UNITS_PER_QUARTER = true;
    } else {
        newOverrides.TARGET_UNITS_PER_QUARTER = false;
    }

    // Validate settings
    const finalMinUnits = newOverrides.MIN_UNITS_PER_QUARTER ?
        newConfig.MIN_UNITS_PER_QUARTER : PLANNING_CONFIG.MIN_UNITS_PER_QUARTER;
    const finalMaxUnits = PLANNING_CONFIG.MAX_UNITS_PER_QUARTER;
    const finalTargetUnits = newOverrides.TARGET_UNITS_PER_QUARTER ?
        newConfig.TARGET_UNITS_PER_QUARTER : PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER;

    const settingsError = document.getElementById('settingsError');
    if (finalMinUnits > finalMaxUnits || finalTargetUnits > finalMaxUnits) {
        settingsError.textContent = finalMinUnits > finalMaxUnits
            ? `Min units (${finalMinUnits}) can't be more than max units (${finalMaxUnits}).`
            : `Target units (${finalTargetUnits}) can't be more than max units (${finalMaxUnits}).`;
        settingsError.style.display = 'block';
        return;
    }
    settingsError.style.display = 'none';
    
    // Apply settings
    Object.assign(PLANNING_CONFIG, newConfig);
    Object.assign(PLANNING_CONFIG.overrides, newOverrides);

    const checkedSpeedRadio = document.querySelector('input[name="planningSpeed"]:checked');
    planningSpeed = checkedSpeedRadio ? checkedSpeedRadio.value : 'balanced';
    const checkedEngineRadio = document.querySelector('input[name="plannerEngine"]:checked');
    plannerEngine = checkedEngineRadio ? checkedEngineRadio.value : 'optimal';

    // Recalculate dynamic settings for non-overridden values
    updateDynamicSettings();

    // Save to localStorage
    localStorage.setItem('planningConfig', JSON.stringify(PLANNING_CONFIG));
    localStorage.setItem('dynamicSettings', JSON.stringify(dynamicSettings));
    localStorage.setItem('planningSpeed', planningSpeed);
    localStorage.setItem('plannerEngine', plannerEngine);

    closeSettingsModal();
    if (lastPlanRun) markPlanStale('Settings');
    else showSuccessMessage('Settings saved.');
}

function resetToDefaults() {
    // Clear all override flags (including max units in the toolbar)
    Object.keys(PLANNING_CONFIG.overrides).forEach(key => {
        PLANNING_CONFIG.overrides[key] = false;
    });

    // Recalculate automatic values and show them as placeholders
    updateDynamicSettings();
    loadCurrentSettings();
    document.getElementById('minUnits').value = '';
    document.getElementById('targetUnits').value = '';

    showSuccessMessage('Units reset to automatic.');
}

function showSuccessMessage(message) {
    // Create a temporary success message
    const successDiv = document.createElement('div');
    successDiv.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: #10b981;
        color: white;
        padding: 12px 20px;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(16, 185, 129, 0.3);
        z-index: 3000;
        font-size: 14px;
        font-weight: 500;
        opacity: 0;
        transform: translateY(-10px);
        transition: all 0.3s ease;
    `;
    successDiv.textContent = message;
    document.body.appendChild(successDiv);
    
    // Animate in
    setTimeout(() => {
        successDiv.style.opacity = '1';
        successDiv.style.transform = 'translateY(0)';
    }, 100);
    
    // Remove after 3 seconds
    setTimeout(() => {
        successDiv.style.opacity = '0';
        successDiv.style.transform = 'translateY(-10px)';
        setTimeout(() => {
            document.body.removeChild(successDiv);
        }, 300);
    }, 3000);
}

// Load settings from localStorage on page load
function loadSavedSettings() {
    const savedSystem = localStorage.getItem('academicSystem');
    if (savedSystem) {
        currentAcademicSystem = savedSystem;
    }
    
    const savedConfig = localStorage.getItem('planningConfig');
    if (savedConfig) {
        try {
            const config = JSON.parse(savedConfig);
            Object.assign(PLANNING_CONFIG, config);
        } catch (e) {
            console.warn('Failed to load saved planning configuration');
        }
    }

    const savedEngine = localStorage.getItem('plannerEngine');
    if (savedEngine === 'optimal' || savedEngine === 'heuristic') {
        plannerEngine = savedEngine;
    }

    const savedPlanningSpeed = localStorage.getItem('planningSpeed');
    if (savedPlanningSpeed === 'balanced' || savedPlanningSpeed === 'fastest') {
        planningSpeed = savedPlanningSpeed;
    }

    const savedDynamicSettings = localStorage.getItem('dynamicSettings');
    if (savedDynamicSettings) {
        try {
            const settings = JSON.parse(savedDynamicSettings);
            Object.assign(dynamicSettings, settings);
        } catch (e) {
            console.warn('Failed to load saved dynamic settings');
        }
    }
    
    // Initialize UI with loaded settings
    initializeDynamicUI();

    loadSavedCategoryPriority();
    loadSavedRequirementTargets();
}

function initializeDynamicUI() {
    syncTimelineControls();

    // Calculate and update displays (totalUnitsNeeded is now calculated from course data)
    updateDynamicSettings();
    
    // Always initialize quarters and render planner on initial load
    initializeQuarters();
    renderPlanner();
}

// Push the current academic system and timeline into the setup controls.
function syncTimelineControls() {
    const academicSystemSelect = getElementByIdWithFallback('academicSystemNew', 'academicSystemMain');
    if (academicSystemSelect) {
        academicSystemSelect.value = currentAcademicSystem;
    }
    
    // Update graduation timeline UI based on academic system
    updateAcademicSystemUI();
    
    const quartersSelect = getElementByIdWithFallback('quartersToGraduateNew', 'quartersToGraduate');
    const customInput = getElementByIdWithFallback('customQuartersNew', 'customQuarters');
    
    if (dynamicSettings.useCustomQuarters) {
        if (quartersSelect) quartersSelect.value = 'custom';
        if (customInput) {
            customInput.value = dynamicSettings.customQuarters;
            customInput.style.display = 'inline-block';
        }
    } else {
        if (quartersSelect) quartersSelect.value = dynamicSettings.quartersToGraduate;
        if (customInput) customInput.style.display = 'none';
    }
}

function updateAcademicSystemUI() {
    // Update graduation timeline label and options based on academic system
    const graduationLabel = getElementByIdWithFallback('graduationTimelineLabelNew', 'graduationTimelineLabel');
    const graduationSelect = getElementByIdWithFallback('quartersToGraduateNew', 'quartersToGraduate');
    const customInput = getElementByIdWithFallback('customQuartersNew', 'customQuarters');
    
    if (currentAcademicSystem === 'semester') {
        // Update label for semester system
        if (graduationLabel) graduationLabel.textContent = 'Graduate in';
        
        // Update dropdown options for semesters
        if (graduationSelect) {
            graduationSelect.innerHTML = `
                <option value="4">2 years (4 semesters)</option>
                <option value="6">3 years (6 semesters)</option>
                <option value="8" selected>4 years (8 semesters)</option>
                <option value="10">5 years (10 semesters)</option>
                <option value="custom">Custom…</option>
            `;
        }
        
        // Update placeholder for custom input
        if (customInput) customInput.placeholder = 'Enter semesters';
    } else {
        // Update label for quarter system
        if (graduationLabel) graduationLabel.textContent = 'Graduate in';
        
        // Update dropdown options for quarters
        if (graduationSelect) {
            graduationSelect.innerHTML = `
                <option value="8">2 years (8 quarters)</option>
                <option value="12">3 years (12 quarters)</option>
                <option value="16" selected>4 years (16 quarters)</option>
                <option value="20">5 years (20 quarters)</option>
                <option value="custom">Custom…</option>
            `;
        }
        
        // Update placeholder for custom input
        if (customInput) customInput.placeholder = 'Enter quarters';
    }
}

// Dynamic Settings Functions
// Automatic min / max / target units per term. Spreads the units still to
// plan over the terms still open: courses in locked or summer terms are
// already done, and those terms take nothing new, so counting them would
// leave the open terms short.
function calculateDynamicSettings() {
    const quartersToGrad = dynamicSettings.useCustomQuarters ?
        dynamicSettings.customQuarters :
        dynamicSettings.quartersToGraduate;

    const activeCourses = ALL_CLASSES_DATA.filter(course => course.enabled !== false);
    const totalUnits = activeCourses.length > 0
        ? activeCourses.reduce((sum, course) => sum + (course.units || 0), 0)
        : 180; // nothing loaded yet

    const isClosed = q => q.name.toLowerCase().includes('summer') || isQuarterLocked(q.id);
    const terms = quartersData.filter(q => q.id !== 'unassigned');
    let openTerms = terms.filter(q => !isClosed(q)).length;
    let unitsToPlan = totalUnits - terms.filter(isClosed)
        .reduce((sum, q) => sum + q.classes.reduce((u, id) => u + (findClassById(id)?.units || 0), 0), 0);
    if (openTerms === 0) {
        // Grid not built yet: estimate from the timeline (summers excluded)
        openTerms = currentAcademicSystem === 'quarter' ? Math.floor(quartersToGrad * 0.75) : quartersToGrad;
        unitsToPlan = totalUnits;
    }

    const unitsPerTerm = Math.max(0, unitsToPlan) / Math.max(1, openTerms);
    const minUnits = 12; // Hard-set to 12 units
    // Never below the minimum load or below the largest single course, or
    // that course could never be scheduled.
    const largestCourseUnits = activeCourses.reduce((max, c) => Math.max(max, c.units || 0), 0);
    const maxUnits = Math.max(minUnits, largestCourseUnits,
        Math.min(22, Math.ceil(unitsPerTerm * 1.06)));
    const targetUnits = Math.min(maxUnits, Math.max(1, Math.round(unitsPerTerm)));

    return {
        minUnits,
        maxUnits,
        targetUnits,
        academicQuarters: openTerms,
        unitsPerTerm: unitsPerTerm.toFixed(1),
        actualTotalUnits: totalUnits,
        courseCount: activeCourses.length
    };
}

// Refresh the automatic (non-overridden) unit settings from the current plan.
function applyAutomaticUnitSettings() {
    const calculated = calculateDynamicSettings();
    if (!PLANNING_CONFIG.overrides.MIN_UNITS_PER_QUARTER) {
        PLANNING_CONFIG.MIN_UNITS_PER_QUARTER = calculated.minUnits;
    }
    if (!PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER) {
        PLANNING_CONFIG.MAX_UNITS_PER_QUARTER = calculated.maxUnits;
    }
    if (!PLANNING_CONFIG.overrides.TARGET_UNITS_PER_QUARTER) {
        PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER = calculated.targetUnits;
    }
}

function updateDynamicSettings() {
    const quartersSelect = getElementByIdWithFallback('quartersToGraduateNew', 'quartersToGraduate');
    const customInput = getElementByIdWithFallback('customQuartersNew', 'customQuarters');
    
    // Store previous values to detect changes
    const previousQuarters = dynamicSettings.useCustomQuarters ? 
        dynamicSettings.customQuarters : 
        dynamicSettings.quartersToGraduate;
    
    // Update dynamic settings object
    if (quartersSelect.value === 'custom') {
        dynamicSettings.useCustomQuarters = true;
        dynamicSettings.customQuarters = parseInt(customInput.value) || 16;
        customInput.style.display = 'inline-block';
    } else {
        dynamicSettings.useCustomQuarters = false;
        dynamicSettings.quartersToGraduate = parseInt(quartersSelect.value);
        customInput.style.display = 'none';
    }

    // Check if graduation timeline changed
    const newQuarters = dynamicSettings.useCustomQuarters ?
        dynamicSettings.customQuarters :
        dynamicSettings.quartersToGraduate;

    // If timeline changed, rebuild the grid but keep placements in quarters
    // that still exist
    if (newQuarters !== previousQuarters) {
        rebuildQuartersKeepingPlacements();
        renderPlanner();
        markPlanStale('The graduation timeline');
    }

    // Calculate and apply dynamic settings based on actual course data
    applyAutomaticUnitSettings();

    // Save settings
    saveDynamicSettings();
    syncMaxUnitsQuick();
}

function updateAcademicSystem() {
    const systemSelect = getElementByIdWithFallback('academicSystemNew', 'academicSystemMain');
    if (systemSelect) {
        currentAcademicSystem = systemSelect.value;
    }
    
    // Update graduation timeline UI based on academic system
    updateAcademicSystemUI();
    
    const quartersSelect = getElementByIdWithFallback('quartersToGraduateNew', 'quartersToGraduate');
    const customInput = getElementByIdWithFallback('customQuartersNew', 'customQuarters');
    
    // Adjust current selection to equivalent term count when switching systems
    if (!dynamicSettings.useCustomQuarters) {
        const currentTerms = dynamicSettings.quartersToGraduate;
        if (currentAcademicSystem === 'semester') {
            // Convert quarters to semesters (divide by 2)
            const equivalentSemesters = Math.round(currentTerms / 2);
            dynamicSettings.quartersToGraduate = equivalentSemesters;
            if (quartersSelect) quartersSelect.value = equivalentSemesters;
        } else {
            // Convert semesters to quarters (multiply by 2)
            const equivalentQuarters = currentTerms * 2;
            dynamicSettings.quartersToGraduate = equivalentQuarters;
            if (quartersSelect) quartersSelect.value = equivalentQuarters;
        }
    }
    
    // Handle custom selection
    if (dynamicSettings.useCustomQuarters) {
        if (quartersSelect) quartersSelect.value = 'custom';
        if (customInput) customInput.style.display = 'inline-block';
    }
    
    // Term ids differ between systems, so start over from the Taken column
    // (completed history) and clear pins/locks that pointed at old terms.
    pinnedCourses = new Set();
    lockedQuarters = new Set();
    initializeQuarters();
    processTakenCourses();
    renderPlanner();
    
    // Recalculate dynamic settings
    updateDynamicSettings();
    markPlanStale('The term system');
    
    // Save to localStorage
    localStorage.setItem('academicSystem', currentAcademicSystem);
}

// Re-create quarters for a new timeline, carrying each course (and its pin)
// over to the same quarter id when that quarter still exists. Courses in
// removed quarters return to Unassigned; stale pins and locks are dropped.
function rebuildQuartersKeepingPlacements() {
    const previous = quartersData.filter(q => q.id !== 'unassigned');
    initializeQuarters();
    const unassigned = getQuarterById('unassigned');

    previous.forEach(oldQuarter => {
        const quarter = getQuarterById(oldQuarter.id);
        if (!quarter) return;
        const ids = oldQuarter.classes.filter(id => isActiveCourseId(id));
        quarter.classes = ids;
        quarter.pinnedClasses = (oldQuarter.pinnedClasses || []).filter(id => ids.includes(id));
        quarter.lockAddedPins = (oldQuarter.lockAddedPins || []).filter(id => ids.includes(id));
        quarter.units = ids.reduce((sum, id) => sum + (findClassById(id).units || 0), 0);
        if (unassigned) unassigned.classes = unassigned.classes.filter(id => !ids.includes(id));
    });

    const stillPinned = new Set(quartersData.flatMap(q => q.pinnedClasses || []));
    pinnedCourses = new Set([...pinnedCourses].filter(id => stillPinned.has(id)));
    lockedQuarters = new Set([...lockedQuarters].filter(id => getQuarterById(id)));
}

function saveDynamicSettings() {
    localStorage.setItem('dynamicSettings', JSON.stringify(dynamicSettings));
    localStorage.setItem('planningConfig', JSON.stringify(PLANNING_CONFIG));
}

document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings first
    loadSavedSettings();

    const dataUrlInput = getElementByIdWithFallback('dataUrlNew', 'dataUrl');
    if (dataUrlInput && dataUrlInput.value) {
        loadCourseData();
    } else if (loadPlanFromLocalStorage()) {
        // Restored your last session's course list + plan from this browser
        renderPlanner();
    } else {
        initializeQuarters();
        renderPlanner();
    }
    showDataEmptyState(false);
    syncMaxUnitsQuick();
    handleSharedLinkOnLoad();
});

function openPlannerTemplate() {
    // Open the planner template in a new tab
    const templateUrl = 'https://docs.google.com/spreadsheets/d/11h6T1080j6RTk9EUBoycZvgq-gj-Add7Y0oL3-ztW70/edit?usp=sharing'; // Replace with actual template URL
    window.open(templateUrl, '_blank', 'noopener,noreferrer');
}

// Picking a file loads it right away.
function handleQuickFileSelect(event) {
    const fileInput = event.target;
    if (fileInput.files.length === 0) return;
    const file = fileInput.files[0];
    const fileNameStr = file.name.toLowerCase();
    if (!fileNameStr.endsWith('.csv') && !fileNameStr.endsWith('.tsv') && !fileNameStr.endsWith('.txt')) {
        showError("Please choose a CSV or TSV file (.csv, .tsv, or .txt).");
        fileInput.value = '';
        return;
    }
    loadCourseDataFromQuickFile(file).finally(() => { fileInput.value = ''; });
}

async function loadCourseDataFromQuickFile(file) {
    try {
        document.body.classList.add('loading');
        document.getElementById('errorMessage').style.display = 'none';
        graph = {};
        const tsvData = await readFileAsText(file);
        await processTSVData(tsvData);
        setDataSource(file.name);
    } catch (error) {
        console.error("Error in loadCourseDataFromQuickFile:", error);
        showError("Couldn't load that file. " + error.message);
        document.body.classList.remove('loading');
    }
}

// Where the current course list came from, shown in the data bar.
function setDataSource(label) {
    try { localStorage.setItem('dataSourceLabel', label); } catch (e) { /* storage unavailable */ }
    showDataEmptyState(false);
}

function getDataSourceLabel() {
    try { return localStorage.getItem('dataSourceLabel') || 'Course list'; } catch (e) { return 'Course list'; }
}

// The empty state shows when there's no course list, or when the user
// clicks Replace; otherwise a one-line data bar takes its place.
function showDataEmptyState(show) {
    const hasData = ALL_CLASSES_DATA.length > 0;
    const showEmpty = show || !hasData;
    const empty = document.getElementById('dataEmptyState');
    const bar = document.getElementById('dataLoadedBar');
    const cancel = document.getElementById('cancelReplaceButton');
    if (!empty || !bar) return;
    empty.hidden = !showEmpty;
    bar.hidden = showEmpty;
    if (cancel) cancel.hidden = !(showEmpty && hasData);
    updateDataBar();
}

function updateDataBar() {
    const label = document.getElementById('dataSourceLabel');
    const count = document.getElementById('dataCourseCount');
    if (!label || !count) return;
    const active = ALL_CLASSES_DATA.filter(c => c.enabled !== false).length;
    label.textContent = getDataSourceLabel();
    count.textContent = `${active} course${active === 1 ? '' : 's'}`;
}
