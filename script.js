let ALL_CLASSES_DATA = [];
let quartersData = [];
let draggedClassId = null;
let graph = {};
let pinnedCourses = new Set(); // Track which courses are pinned
let lockedQuarters = new Set(); // Track which quarters are locked
let currentAcademicSystem = 'quarter'; // 'quarter' or 'semester'

// Dynamic settings based on graduation timeline
let dynamicSettings = {
    quartersToGraduate: 12,
    useCustomQuarters: false,
    customQuarters: 16
};

// Configuration constants for course planning optimization
const PLANNING_CONFIG = {
    MAX_UNITS_PER_QUARTER: 16,
    MIN_UNITS_PER_QUARTER: 12,
    TARGET_UNITS_PER_QUARTER: 13,
    MAX_ATTEMPTS_MIN_UNITS: 5,
    SCORING: {
        UNDER_MIN_UNITS_BONUS: 300,
        MEETS_MIN_UNITS_BONUS: 150,
        OVER_MAX_UNITS_PENALTY: 1000,
        UNITS_DEVIATION_PENALTY: 10,
        LATER_QUARTER_PENALTY: 15,
        HEAVY_COURSE_STACKING_PENALTY: 20
    },
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
    'Probability, Stats & DS Minor',
    'Stats & DS Minor',
    'ST, Stats & DS Minor',
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
    TARGET_COURSE_COUNT: 4
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

async function loadCourseData() {
    const urlInput = getElementByIdWithFallback('dataUrlNew', 'dataUrl');
    const errorMessage = document.getElementById('errorMessage');
    const url = urlInput.value.trim();
    
    // Check if a file has been uploaded via the quick file input
    const quickFileInput = document.getElementById('quickFileInput');
    const hasUploadedFile = quickFileInput && quickFileInput.files.length > 0;

    try {
        document.body.classList.add('loading');
        errorMessage.style.display = 'none';

        // Clear all pinned courses and do a hard reset
        pinnedCourses.clear();
        lockedQuarters.clear();
        graph = {};

        if (hasUploadedFile) {
            // Load from uploaded file
            const file = quickFileInput.files[0];

            // Validate file extension
            const fileNameStr = file.name.toLowerCase();
            if (!fileNameStr.endsWith('.csv') && !fileNameStr.endsWith('.tsv') && !fileNameStr.endsWith('.txt')) {
                throw new Error("Please select a CSV or TSV file (.csv, .tsv, or .txt extension)");
            }
            
            const tsvData = await readFileAsText(file);
            await processTSVData(tsvData);
        } else if (url) {
            // Load from URL
            // Clear file uploaded state when loading from URL
            const uploadButton = document.querySelector('.upload-icon-button');
            if (uploadButton) uploadButton.classList.remove('file-uploaded');
            updateFileNameDisplay(null);

            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`Failed to fetch data (status: ${response.status})`);
            }

            const tsvData = await response.text();
            await processTSVData(tsvData);
        } else {
            throw new Error("Please either upload a TSV file or enter a valid URL");
        }
        
    } catch (error) {
        console.error("Error in loadCourseData:", error);
        showError("Error loading data: " + error.message);
        document.body.classList.remove('loading');
    }
}

function handleFileSelect(event) {
    const fileInput = event.target;
    const loadFileButton = document.getElementById('loadFileButton');
    const errorMessage = document.getElementById('errorMessage');
    const fileInfo = document.getElementById('fileInfo');
    const fileName = document.getElementById('fileName');
    
    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];
        
        // Check file extension
        const fileNameStr = file.name.toLowerCase();
        if (!fileNameStr.endsWith('.csv') && !fileNameStr.endsWith('.tsv') && !fileNameStr.endsWith('.txt')) {
            showError("Please select a CSV or TSV file (.csv, .tsv, or .txt extension)");
            loadFileButton.disabled = true;
            fileInfo.style.display = 'none';
            return;
        }
        
        // Show file info
        fileName.textContent = file.name;
        fileInfo.style.display = 'flex';
        loadFileButton.disabled = false;
        errorMessage.style.display = 'none';
    } else {
        fileInfo.style.display = 'none';
        loadFileButton.disabled = true;
    }
}

async function loadCourseDataFromFile() {
    const fileInput = document.getElementById('fileInput');
    const errorMessage = document.getElementById('errorMessage');
    
    if (!fileInput.files.length) {
        showError("Please select a file first");
        return;
    }
    
    const file = fileInput.files[0];
    
    try {
        document.body.classList.add('loading');
        errorMessage.style.display = 'none';

        // Clear all pinned courses and do a hard reset
        pinnedCourses.clear();
        lockedQuarters.clear();
        graph = {};

        // Read file content
        const tsvData = await readFileAsText(file);
        await processTSVData(tsvData);
        
    } catch (error) {
        console.error("Error in loadCourseDataFromFile:", error);
        showError("Error loading file: " + error.message);
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
    const optionalColumns = ['Taken', 'Corequisites', 'Req Satisfied', 'Units', 'Difficulty'];

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
        prerequisites: (row['Prerequisites'] && row['Prerequisites'].trim().toLowerCase() !== 'none' && row['Prerequisites'].trim() !== '')
                     ? row['Prerequisites'].split(/,\s*|\/\s*/).map(p => p.trim()).filter(p => p)
                     : [],
        corequisites: (row['Corequisites'] && row['Corequisites'].trim().toLowerCase() !== 'none' && row['Corequisites'].trim() !== '')
                     ? row['Corequisites'].split(/,\s*|\/\s*/).map(p => p.trim()).filter(p => p)
                     : [],
        description: row['Description'],
        units: parseInt(row['Units']) || parseInt(row['Difficulty']) || 0,
        reqSatisfied: row['Req Satisfied'] ? row['Req Satisfied'].trim() : 'Required', // New column for requirement category
        category: "Required", // Default all courses to Required
        taken: row['Taken'] ? row['Taken'].trim() : '',
        originalOrder: index
    }));

    // Validate the parsed data
    validateTSVData(courseData);

    // Show validation success message
    console.log(`✅ TSV Validation Passed: ${courseData.length} courses loaded successfully`);

    // If validation passes, assign to global variable
    ALL_CLASSES_DATA = courseData;

    // Initialize fresh quarters with no pinned courses
    initializeQuarters();
    
    // Process courses with "Taken" assignments
    processTakenCourses();
    
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
        course.prerequisites.forEach(prereqId => {
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
        course.prerequisites.forEach(prereqId => {
            const prereqCourse = courseData.find(c => c.id.trim() === prereqId.trim());
            if (prereqCourse && prereqCourse.prerequisites.some(p => p.trim() === course.id.trim())) {
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
    const lines = text.trim().split('\n').filter(line => line.trim() !== '');
    if (lines.length < 1) return [];

    // Detect delimiter: check first line for tabs or commas
    const firstLine = lines[0];
    const tabCount = (firstLine.match(/\t/g) || []).length;
    const commaCount = (firstLine.match(/,/g) || []).length;

    const delimiter = tabCount > commaCount ? '\t' : ',';

    // Parse CSV with proper quote handling
    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < line.length; i++) {
            const char = line[i];

            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    // Escaped quote
                    current += '"';
                    i++;
                } else {
                    // Toggle quote state
                    inQuotes = !inQuotes;
                }
            } else if (char === delimiter && !inQuotes) {
                result.push(current.trim());
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current.trim());
        return result;
    }

    const headers = parseCSVLine(lines[0]);

    return lines.slice(1).map(line => {
        const values = parseCSVLine(line);
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] || '';
            return obj;
        }, {});
    });
}

// Keep parseTSV as an alias for backwards compatibility
function parseTSV(tsvText) {
    return parseDelimited(tsvText);
}

function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    
    // Convert newlines to HTML line breaks for better display
    const formattedMessage = message.replace(/\n/g, '<br>');
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
    const unassignedClassesIds = ALL_CLASSES_DATA.map(c => c.id);
    quartersData.unshift({
        id: "unassigned",
        name: "Unassigned Classes",
        classes: unassignedClassesIds,
        pinnedClasses: [], // Unassigned can't have pinned courses
        units: 0
    });
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
        yearDiv.innerHTML = `<h3>Year ${i}</h3>`;
        
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
            lockButton.title = isQuarterLocked(quarter.id) ? 'Unlock quarter' : 'Lock quarter';
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

            if (quarter.backupOptions && quarter.backupOptions.length > 0) {
                const backupsDiv = document.createElement('div');
                backupsDiv.className = 'quarter-backups';

                const label = document.createElement('span');
                label.className = 'quarter-backups-label';
                label.textContent = 'Backups:';
                backupsDiv.appendChild(label);

                quarter.backupOptions.forEach(backup => {
                    const chip = document.createElement('span');
                    chip.className = 'quarter-backup-chip';
                    chip.textContent = backup.name;
                    chip.title = `Next-best alternative if a placed course here becomes unavailable`;
                    backupsDiv.appendChild(chip);
                });

                quarterDiv.appendChild(backupsDiv);
            }

            quartersDiv.appendChild(quarterDiv);
        });
        yearDiv.appendChild(quartersDiv);
        yearsContainer.appendChild(yearDiv);
    }
    addDragDropListeners();
    updateAllUnitCounts();
    updateRequirementProgress(); // Update requirement progress dashboard
    validateAllPrerequisites();
}

function createClassCard(classData) {
    const card = document.createElement('div');
    card.className = 'class-card';
    card.id = `class-${classData.id.replace(/\s+/g, '-')}`; 
    card.draggable = true;
    card.dataset.classId = classData.id;
    
    // Apply custom color if set - will be handled after card content is populated
    
    // Add pinned class if course is pinned
    if (isPinnedCourse(classData.id)) {
        card.classList.add('pinned');
    }
    
    const prereqsText = classData.prerequisites.join(', ') || 'None';
    const coreqsText = classData.corequisites.join(', ') || 'None';
    
    // Check for conflicts to include in description
    const quarterElement = card.closest('.quarter');
    let conflictDescription = '';
    
    if (quarterElement && quarterElement.id !== 'unassignedClasses') {
        const quarterId = quarterElement.id;
        const validation = validateCoursePlacement(classData.id, quarterId);
        if (!validation.isValid) {
            conflictDescription = `<div style="color: #dc2626; font-weight: 600; margin-top: 8px; padding: 6px; background: rgba(239, 68, 68, 0.1); border-radius: 4px; font-size: 12px;">
                ⚠️ ${validation.reason}
            </div>`;
        }
    } else if (graph[classData.id] && graph[classData.id].unassignedReason) {
        conflictDescription = `<div style="color: #ea580c; font-weight: 600; margin-top: 8px; padding: 6px; background: rgba(251, 146, 60, 0.1); border-radius: 4px; font-size: 12px;">
            ⚠️ ${graph[classData.id].unassignedReason}
        </div>`;
    }

    // Create structured tooltip content
    let tooltipContent = `
        <span class="course-title">${classData.description || 'No description available'}</span>
        <div class="course-req">
            <span class="req-label">Requirement:</span>
            <span class="req-value">${classData.reqSatisfied || 'Required'}</span>
        </div>
        <div class="course-prereqs">
            <span class="prereq-label">Prerequisites:</span>
            <span class="prereq-list">${prereqsText}</span>
        </div>
        <div class="course-coreqs">
            <span class="coreq-label">Corequisites:</span>
            <span class="coreq-list">${coreqsText}</span>
        </div>
    `;


    let planningNote = "";
    if (graph[classData.id] && graph[classData.id].unassignedReason) {
        planningNote = graph[classData.id].unassignedReason;
        card.classList.add('class-card-unassigned-failed');
    }

    if (planningNote) {
        const noteClass = card.classList.contains('class-card-unassigned-failed') ? 'warning' : '';
        tooltipContent += `<div class="planning-note ${noteClass}">
            <strong>Planning Note:</strong> ${planningNote}
            <p>Try playing around with the max units to get your desired results!</p>
        </div>`;
    }

    // Create pin button
    const pinButton = document.createElement('button');
    pinButton.className = 'pin-button';
    pinButton.innerHTML = isPinnedCourse(classData.id) ? '📌' : '📍';
    pinButton.title = isPinnedCourse(classData.id) ? 'Unpin course' : 'Pin course';
    pinButton.onclick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        handlePinToggle(classData.id);
    };

    // Get category color for the card
    const categoryColor = getCategoryColor(classData.reqSatisfied);

    card.innerHTML = `
        ${classData.name}
        <span class="units">(${classData.units} units)</span>
        <span class="tooltip">${tooltipContent}</span>
    `;
    
    card.appendChild(pinButton);

    // Apply category color based on reqSatisfied
    if (categoryColor) {
        card.style.backgroundColor = categoryColor.bg;
        card.style.borderColor = categoryColor.border;
        card.style.color = categoryColor.text;
        // Apply text color to all text elements
        const textElements = card.querySelectorAll('.units, .tooltip, .course-title, .prereq-label, .coreq-label, .prereq-list, .coreq-list, .planning-note, .req-label, .req-value');
        textElements.forEach(el => {
            if (el) el.style.color = categoryColor.text;
        });
    }

    // Add double-click event listener to the card for editing
    card.addEventListener('dblclick', handleCardDoubleClick);

    return card;
}

// Get color for a requirement category
function getCategoryColor(reqSatisfied) {
    if (!reqSatisfied) return null;

    const colors = {
        'Lower Div': { bg: '#dbeafe', border: '#3b82f6', text: '#1e40af' },
        'Major Core': { bg: '#f3e8ff', border: '#a855f7', text: '#7c3aed' },
        '5 Elective': { bg: '#dcfce7', border: '#22c55e', text: '#16a34a' },
        'Capstone': { bg: '#fef3c7', border: '#f59e0b', text: '#d97706' },
        'Grad Level': { bg: '#fce7f3', border: '#ec4899', text: '#db2777' },
        'TB': { bg: '#fef9c3', border: '#eab308', text: '#a16207' },
        'ST': { bg: '#e0e7ff', border: '#6366f1', text: '#4f46e5' },
        'GE': { bg: '#fed7aa', border: '#f97316', text: '#ea580c' },
        'Probability': { bg: '#ccfbf1', border: '#14b8a6', text: '#0d9488' },
        'Stats & DS Minor': { bg: '#cffafe', border: '#06b6d4', text: '#0891b2' },
        'Required': { bg: '#f1f5f9', border: '#64748b', text: '#475569' }
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
        const rawCategory = course.reqSatisfied || 'Required';

        // Split by comma to handle multiple categories (e.g., "Probability, Stats & DS Minor")
        const categories = rawCategory.split(',').map(c => c.trim()).filter(c => c);

        categories.forEach(category => {
            if (!requirementCategories[category]) {
                requirementCategories[category] = { total: 0, assigned: 0 };
            }
            requirementCategories[category].total++;

            // Check if course is assigned (not in unassigned)
            if (!unassignedCourseIds.includes(course.id)) {
                requirementCategories[category].assigned++;
            }
        });
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

        dashboardHTML += `
            <div class="requirement-item">
                <div class="requirement-header">
                    <span class="requirement-name" style="color: ${bgColor}">${category}</span>
                    <span class="requirement-count">${stats.assigned}/${stats.total}</span>
                </div>
                <div class="requirement-bar">
                    <div class="requirement-progress" style="width: ${percentage}%; background-color: ${bgColor}"></div>
                </div>
            </div>
        `;
    });

    dashboardContainer.innerHTML = dashboardHTML;
}

function handleFieldEdit(event) {
    // No longer needed - difficulty editing removed
}


function handleCardDoubleClick(event) {
    const card = event.currentTarget;
    const classId = card.dataset.classId;
    const course = ALL_CLASSES_DATA.find(c => c.id === classId);
    
    if (course) {
        showEditModal(course);
    }
}

function showEditModal(course) {
    // Create modal overlay
    const modal = document.createElement('div');
    modal.className = 'edit-modal';
    modal.innerHTML = `
        <div class="edit-modal-content">
            <div class="edit-modal-header">
                <input type="color" id="edit-color" class="color-picker" value="${course.color || '#ffffff'}">
                <h3>Edit Course: ${course.name}</h3>
            </div>
            <form id="edit-course-form">
                <div class="edit-form-group">
                    <label for="edit-name">Course Name</label>
                    <input type="text" id="edit-name" value="${course.name}">
                </div>
                <div class="edit-form-group">
                    <label for="edit-description">Description</label>
                    <textarea id="edit-description" rows="3">${course.description || ''}</textarea>
                </div>
                <div class="edit-form-group">
                    <label for="edit-units">Units</label>
                    <input type="number" id="edit-units" value="${course.units}" min="1" max="10">
                </div>
                <div class="edit-form-group">
                    <label for="edit-reqsatisfied">Requirement Category</label>
                    <input type="text" id="edit-reqsatisfied" value="${course.reqSatisfied || 'Required'}">
                </div>
                <div class="edit-form-group">
                    <label for="edit-prerequisites">Prerequisites (comma-separated)</label>
                    <input type="text" id="edit-prerequisites" value="${course.prerequisites.join(', ')}">
                </div>
                <div class="edit-form-group">
                    <label for="edit-corequisites">Corequisites (comma-separated)</label>
                    <input type="text" id="edit-corequisites" value="${course.corequisites.join(', ')}">
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
        course.prerequisites = prereqsText ? prereqsText.split(',').map(p => p.trim()).filter(p => p) : [];
        
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
                alert('Cannot pin courses with unmet prerequisites (red courses). Please resolve prerequisite issues first.');
                return;
            }
            
            pinCourse(classId, currentQuarter.id);
        } else {
            alert('Cannot pin courses in unassigned section. Please move the course to a quarter first.');
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
        c.prerequisites.includes(courseId)
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
    course.prerequisites.forEach(prereqId => {
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
        c.prerequisites.includes(draggedClassId)
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
    course.prerequisites.forEach(prereqId => {
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
    
    let originalQuarter = quartersData.find(q => q.classes.includes(classId));
    if (originalQuarter) {
        originalQuarter.classes = originalQuarter.classes.filter(id => id !== classId);
    }

    const newQuarter = getQuarterById(targetQuarterId);
    if (newQuarter) {
        // Allow placement but show conflict reason
        const validationResult = validateCoursePlacement(classId, targetQuarterId);
        
        // Allow placement without showing conflict message
        
        if (!newQuarter.classes.includes(classId)) { 
            newQuarter.classes.push(classId);
        }
    }
    renderPlanner(); 
}

function validateCoursePlacement(classId, targetQuarterId) {
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
    for (const prereqId of course.prerequisites) {
        if (!completedBeforeQuarter.has(prereqId)) {
            const prereqCourse = findClassById(prereqId);
            const prereqName = prereqCourse ? prereqCourse.id : prereqId;
            return { isValid: false, reason: `Missing prerequisite: ${prereqName}` };
        }
    }

    // Check corequisites
    for (const coreqId of course.corequisites) {
        if (!completedBeforeQuarter.has(coreqId) && 
            !targetQuarter.classes.includes(coreqId)) {
            const coreqCourse = findClassById(coreqId);
            const coreqName = coreqCourse ? coreqCourse.id : coreqId;
            return { isValid: false, reason: `Missing corequisite: ${coreqName} (must be taken same quarter)` };
        }
    }

    // Check unit limits
    const currentUnits = targetQuarter.units;
    const newUnits = currentUnits + course.units;
    if (newUnits > PLANNING_CONFIG.MAX_UNITS_PER_QUARTER) {
        return { isValid: false, reason: `Would exceed max units (${PLANNING_CONFIG.MAX_UNITS_PER_QUARTER}). Current: ${currentUnits}, Adding: ${course.units}` };
    }

    return { isValid: true, reason: '' };
}

function getCompletedCoursesBeforeQuarter(targetQuarterId) {
    const completed = new Set();
    
    // Add summer courses as completed
    const summerQuarters = quartersData.filter(q => 
        q.id !== 'unassigned' && q.name.toLowerCase().includes('summer')
    );
    summerQuarters.forEach(quarter => {
        quarter.classes.forEach(courseId => completed.add(courseId));
    });

    // Add courses from quarters before the target quarter
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
                for (const prereqId of classData.prerequisites) {
                    if (!completedClassesCumulative.has(prereqId)) {
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
                    // Corequisite must be in the same quarter
                    if (!quarter.classes.includes(coreqId)) {
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
        .filter(course => course && (course.category === "Required" || course.category === "Capstone" || course.category === "External"))
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
        node.prerequisites.forEach(prereqId => {
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
        ALL_CLASSES_DATA.map(c => c.reqSatisfied).filter(c => c)
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
    return courseNode && REQUIRED_CATEGORIES.has(courseNode.course.reqSatisfied);
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
    const requirementWeight = requirementWeights[course.reqSatisfied] ?? 1;
    const difficultyPenalty = (course.units || 0) * 2;

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

    // Over-difficulty penalty (uses units as difficulty proxy)
    if (totalUnits > workloadConfig.MAX_DIFFICULTY_PER_QUARTER) {
        score -= (totalUnits - workloadConfig.MAX_DIFFICULTY_PER_QUARTER)
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
    return REQUIRED_CATEGORIES.has(course.reqSatisfied)
        || course.reqSatisfied === '5 Elective'
        || course.reqSatisfied === 'ST'
        || course.reqSatisfied === 'Grad Level';
}

function loadCategoryPriorityUI() {
    const list = document.getElementById('categoryPriorityList');
    if (!list) return;

    syncCategoryPriorityWithData();
    const weights = deriveRequirementWeights();

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

        const weight = document.createElement('span');
        weight.className = 'category-weight';
        weight.textContent = `weight ${weights[category] ?? 1}`;
        weight.title = 'Contribution to the priority score for courses in this category. Drag to reorder; the value follows the rank.';

        li.appendChild(handle);
        li.appendChild(rank);
        li.appendChild(name);
        li.appendChild(weight);
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
    return courseNode.prerequisites.every(prereqId =>
        completedBeforeQuarter.has(prereqId) || !graph[prereqId]
    );
}

function generateUnassignedReason(courseNode, academicQuarters, graph) {
    let prereqDetail = "";
    for (const prereqId of courseNode.prerequisites) {
        if (graph[prereqId] && !graph[prereqId].placed) {
            prereqDetail = `Prereq. ${prereqId} not scheduled.`;
            break;
        }

        const prereqCourseData = findClassById(prereqId);
        if (!prereqCourseData && !graph[prereqId]) {
            prereqDetail = `Prereq. ${prereqId} missing from data.`;
            break;
        }
    }

    if (prereqDetail) {
        return prereqDetail;
    }

    // Check if it's a capacity issue (units)
    const course = courseNode.course;
    let hasUnitsCapacity = false;

    // Include summer courses as completed
    const summerQuarters = quartersData.filter(q =>
        q.id !== 'unassigned' && q.name.toLowerCase().includes('summer')
    );
    let tempCompleted = new Set();
    summerQuarters.forEach(summerQuarter => {
        summerQuarter.classes.forEach(courseId => tempCompleted.add(courseId));
    });

    // Check each quarter to see what's blocking placement
    for (const quarter of academicQuarters) {
        // Check if prerequisites would be satisfied
        const prereqsSatisfied = checkPrerequisitesSatisfied(courseNode, tempCompleted, graph);

        if (prereqsSatisfied) {
            const wouldExceedUnits = quarter.units + course.units > PLANNING_CONFIG.MAX_UNITS_PER_QUARTER;

            if (!wouldExceedUnits) hasUnitsCapacity = true;
        }

        // Add this quarter's courses to completed for next iteration
        quarter.classes.forEach(c => tempCompleted.add(c));
    }

    if (!hasUnitsCapacity) {
        return "Blocked by unit capacity. Try increasing max units in Advanced Settings.";
    }

    return "No suitable quarter (capacity/schedule).";
}

function finalizeUnassignedCourses(graph) {
    const unassignedQuarter = getQuarterById('unassigned');
    unassignedQuarter.classes = ALL_CLASSES_DATA
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

function autoPlanCoreCourses() {
    const unassignedQuarter = resetQuartersForPlanning();
    if (!unassignedQuarter) return;

    syncCategoryPriorityWithData();
    const requirementWeights = deriveRequirementWeights();

    graph = initializePlanningGraph();
    const academicQuarters = getAcademicQuartersForPlanning();

    // Summer + locked + pinned courses are pre-placed; their ids count as
    // completed for prerequisite checks in subsequent quarters.
    const completed = new Set();
    const summerQuarters = quartersData.filter(q =>
        q.id !== 'unassigned' && q.name.toLowerCase().includes('summer')
    );
    summerQuarters.forEach(q => q.classes.forEach(id => {
        completed.add(id);
        if (graph[id]) graph[id].placed = true;
    }));
    quartersData.forEach(q => {
        if (q.id !== 'unassigned' && isQuarterLocked(q.id)) {
            q.classes.forEach(id => {
                completed.add(id);
                if (graph[id]) graph[id].placed = true;
            });
        }
    });
    academicQuarters.forEach(q => {
        q.pinnedClasses.forEach(id => {
            if (graph[id]) graph[id].placed = true;
        });
    });

    const feasibility = checkPlanningFeasibility(academicQuarters, graph);
    if (!feasibility.feasible) {
        const reasons = [];
        if (!feasibility.unitsFeasible) {
            reasons.push(
                `${feasibility.unplacedRequiredUnits} units of required courses vs ${feasibility.availableCapacity} ` +
                `units of capacity across ${feasibility.academicQuarterCount} quarters (short by ${feasibility.shortfall} units)`
            );
        }
        if (!feasibility.timelineFeasible) {
            reasons.push(
                `the longest prerequisite chain needs ${feasibility.minQuartersForLongestChain} quarters but only ` +
                `${feasibility.academicQuarterCount} remain before your target graduation date`
            );
        }
        alert(
            `Course plan is infeasible: ${reasons.join('; ')}. Some courses will remain unassigned. ` +
            `Consider increasing max units, adding quarters, or extending your target graduation date in Advanced Settings.`
        );
    }

    // Compute priority scores once — they depend only on graph structure,
    // not on where courses end up.
    const scores = new Map();
    Object.values(graph).forEach(node => {
        if (!node.placed) {
            scores.set(node.course.id, computePriorityScore(node, graph, requirementWeights));
        }
    });

    // Quarter-by-quarter combination selection per spec §"Course Selection
    // Algorithm": for each quarter, find eligible courses, generate unit-
    // feasible combinations, validate coreqs at the combination level, and
    // place the highest-scoring valid combination.
    for (const quarter of academicQuarters) {
        const remainingBudget = getEffectiveMaxUnitsPerQuarter() - quarter.units;
        if (remainingBudget <= 0) {
            quarter.backupOptions = [];
            quarter.classes.forEach(id => completed.add(id));
            continue;
        }

        const eligible = Object.values(graph)
            .filter(node => !node.placed && !completed.has(node.course.id))
            .filter(node => checkPrerequisitesSatisfied(node, completed, graph))
            .sort((a, b) => scores.get(b.course.id) - scores.get(a.course.id));

        if (eligible.length === 0) {
            quarter.backupOptions = [];
            quarter.classes.forEach(id => completed.add(id));
            continue;
        }

        const combos = generateUnitFeasibleCombinations(eligible, remainingBudget);
        const validCombos = combos.filter(combo => combinationCoreqsSatisfied(combo, completed));

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

    // Any course still unplaced after the quarter sweep: generate a reason.
    Object.values(graph).forEach(node => {
        if (!node.placed && !node.unassignedReason) {
            node.unassignedReason = generateUnassignedReason(node, academicQuarters, graph);
        }
    });

    finalizeUnassignedCourses(graph);
    renderPlanner();
}

// Coreqs are satisfied if each course's coreqs are either already completed
// or also in the proposed combination.
function combinationCoreqsSatisfied(combo, completed) {
    const inCombo = new Set(combo.map(n => n.course.id));
    return combo.every(node =>
        node.corequisites.every(coreqId =>
            completed.has(coreqId) || inCombo.has(coreqId) || !graph[coreqId]
        )
    );
}

function toggleSidebar() {
    const sidebar = document.getElementById('instructionsSidebar');
    const overlay = document.getElementById('sidebarOverlay');
    
    if (sidebar.classList.contains('open')) {
        sidebar.classList.remove('open');
        overlay.classList.remove('active');
    } else {
        sidebar.classList.add('open');
        overlay.classList.add('active');
    }
}

function downloadPlan() {
    if (!ALL_CLASSES_DATA || ALL_CLASSES_DATA.length === 0) {
        alert('No course data loaded. Please load course data first.');
        return;
    }

    // Create CSV content with new format
    let csvContent = "Taken,Req Satisfied,Course Number,Prerequisites,Corequisites,Description,Units\n";

    // Process all courses in their original order
    ALL_CLASSES_DATA.forEach(courseData => {
        // Find which quarter this course is in
        let takenValue = 'Not Assigned';
        const courseQuarter = quartersData.find(q => q.classes.includes(courseData.id));

        if (courseQuarter && courseQuarter.id !== 'unassigned') {
            // Convert quarter ID back to "Season, Year X" format
            takenValue = formatQuarterForTaken(courseQuarter.name);
        }

        // Format prerequisites
        const prerequisites = courseData.prerequisites.length > 0 ? courseData.prerequisites.join(', ') : 'None';

        // Format corequisites
        const corequisites = courseData.corequisites.length > 0 ? courseData.corequisites.join(', ') : 'None';

        // Escape quotes and commas in description for CSV
        const description = (courseData.description || '').replace(/"/g, '""').replace(/,/g, ';');

        // Get requirement satisfied
        const reqSatisfied = courseData.reqSatisfied || 'Required';

        // Add row to CSV (quoted fields for safety)
        csvContent += `"${takenValue}","${reqSatisfied}","${courseData.name}","${prerequisites}","${corequisites}","${description}",${courseData.units}\n`;
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
        alert('Download not supported in this browser. Please try a different browser.');
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

function processTakenCourses() {
    console.log('Processing taken courses...');
    console.log('ALL_CLASSES_DATA:', ALL_CLASSES_DATA);
    
    ALL_CLASSES_DATA.forEach(courseData => {
        console.log(`Course ${courseData.id}: taken = "${courseData.taken}"`);
        
        if (courseData.taken && courseData.taken !== '') {
            const quarterId = parseQuarterFromTaken(courseData.taken);
            console.log(`Parsed quarter ID for ${courseData.id}: ${quarterId}`);
            
            if (quarterId) {
                // Remove from unassigned
                const unassignedQuarter = getQuarterById('unassigned');
                if (unassignedQuarter) {
                    unassignedQuarter.classes = unassignedQuarter.classes.filter(id => id !== courseData.id);
                }
                
                // Add to target quarter and pin it
                const targetQuarter = getQuarterById(quarterId);
                console.log(`Target quarter for ${courseData.id}:`, targetQuarter);
                
                if (targetQuarter) {
                    targetQuarter.classes.push(courseData.id);
                    targetQuarter.pinnedClasses.push(courseData.id);
                    pinnedCourses.add(courseData.id);

                    // Update quarter stats
                    targetQuarter.units += courseData.units;

                    console.log(`Successfully placed ${courseData.id} in ${quarterId}`);
                } else {
                    console.log(`Could not find quarter ${quarterId} for course ${courseData.id}`);
                }
            } else {
                console.log(`Could not parse quarter from "${courseData.taken}" for course ${courseData.id}`);
            }
        }
    });
}

function parseQuarterFromTaken(takenValue) {
    console.log(`Parsing taken value: "${takenValue}"`);
    
    // Parse format like "Fall, Year 1" or "Winter, Year 2"
    const match = takenValue.match(/^(Fall|Winter|Spring|Summer),?\s*Year\s*(\d+)$/i);
    if (match) {
        const season = match[1].toLowerCase();
        const year = parseInt(match[2]);
        const result = `${season}${year}`;
        console.log(`Matched format 1: ${result}`);
        return result;
    }
    
    // Also try format like "Fall Year 1" (without comma)
    const match2 = takenValue.match(/^(Fall|Winter|Spring|Summer)\s+Year\s*(\d+)$/i);
    if (match2) {
        const season = match2[1].toLowerCase();
        const year = parseInt(match2[2]);
        const result = `${season}${year}`;
        console.log(`Matched format 2: ${result}`);
        return result;
    }
    
    console.log(`No match found for: "${takenValue}"`);
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
        alert('Cannot lock quarter with courses that have unmet prerequisites (red courses). Please resolve prerequisite issues first.');
        return;
    }
    
    // Pin all courses in the quarter
    quarter.classes.forEach(classId => {
        if (!quarter.pinnedClasses.includes(classId)) {
            quarter.pinnedClasses.push(classId);
            pinnedCourses.add(classId);
        }
    });
    
    lockedQuarters.add(quarterId);
    renderPlanner();
}

function unlockQuarter(quarterId) {
    if (quarterId === 'unassigned') return; // Can't unlock unassigned section
    
    const quarter = getQuarterById(quarterId);
    if (!quarter) return;
    
    // Unpin all courses in the quarter
    quarter.classes.forEach(classId => {
        quarter.pinnedClasses = quarter.pinnedClasses.filter(id => id !== classId);
        pinnedCourses.delete(classId);
    });
    
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
function setupDragAndDrop() {
    const fileUploadArea = document.getElementById('fileUploadArea');
    
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        fileUploadArea.addEventListener(eventName, preventDefaults, false);
    });
    
    function preventDefaults(e) {
        e.preventDefault();
        e.stopPropagation();
    }
    
    ['dragenter', 'dragover'].forEach(eventName => {
        fileUploadArea.addEventListener(eventName, highlight, false);
    });
    
    ['dragleave', 'drop'].forEach(eventName => {
        fileUploadArea.addEventListener(eventName, unhighlight, false);
    });
    
    function highlight(e) {
        fileUploadArea.classList.add('dragover');
    }
    
    function unhighlight(e) {
        fileUploadArea.classList.remove('dragover');
    }
    
    fileUploadArea.addEventListener('drop', handleDrop, false);
    
    function handleDrop(e) {
        const dt = e.dataTransfer;
        const files = dt.files;
        
        if (files.length > 0) {
            const fileInput = document.getElementById('fileInput');
            fileInput.files = files;
            handleFileSelect({ target: fileInput });
        }
    }
}

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

    // Load advanced settings (show current values or empty for dynamic)
    const maxUnitsInput = document.getElementById('maxUnits');
    const minUnitsInput = document.getElementById('minUnits');
    const targetUnitsInput = document.getElementById('targetUnits');

    // Only show values if they are overridden
    maxUnitsInput.value = PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER ?
        PLANNING_CONFIG.MAX_UNITS_PER_QUARTER : '';
    minUnitsInput.value = PLANNING_CONFIG.overrides.MIN_UNITS_PER_QUARTER ?
        PLANNING_CONFIG.MIN_UNITS_PER_QUARTER : '';
    targetUnitsInput.value = PLANNING_CONFIG.overrides.TARGET_UNITS_PER_QUARTER ?
        PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER : '';

    const speedRadio = document.querySelector(`input[name="planningSpeed"][value="${planningSpeed}"]`);
    if (speedRadio) speedRadio.checked = true;
    updatePlanningSpeedToggleUI();
}

function updatePlanningSpeedToggleUI() {
    document.querySelectorAll('.speed-option').forEach(option => {
        const radio = option.querySelector('input[type="radio"]');
        option.classList.toggle('active', !!(radio && radio.checked));
    });
}

function saveSettings() {
    // Get values from advanced settings
    const maxUnitsInput = document.getElementById('maxUnits');
    const minUnitsInput = document.getElementById('minUnits');
    const targetUnitsInput = document.getElementById('targetUnits');

    // Update overrides and values
    const newConfig = {};
    const newOverrides = {};

    // Max Units
    if (maxUnitsInput.value.trim() !== '') {
        newConfig.MAX_UNITS_PER_QUARTER = parseInt(maxUnitsInput.value);
        newOverrides.MAX_UNITS_PER_QUARTER = true;
    } else {
        newOverrides.MAX_UNITS_PER_QUARTER = false;
    }

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
    const finalMaxUnits = newOverrides.MAX_UNITS_PER_QUARTER ?
        newConfig.MAX_UNITS_PER_QUARTER : PLANNING_CONFIG.MAX_UNITS_PER_QUARTER;
    const finalTargetUnits = newOverrides.TARGET_UNITS_PER_QUARTER ?
        newConfig.TARGET_UNITS_PER_QUARTER : PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER;

    if (finalMinUnits > finalMaxUnits) {
        alert('Minimum units cannot be greater than maximum units.');
        return;
    }

    if (finalTargetUnits > finalMaxUnits) {
        alert('Target units cannot be greater than maximum units.');
        return;
    }
    
    // Apply settings
    Object.assign(PLANNING_CONFIG, newConfig);
    Object.assign(PLANNING_CONFIG.overrides, newOverrides);

    const checkedSpeedRadio = document.querySelector('input[name="planningSpeed"]:checked');
    planningSpeed = checkedSpeedRadio ? checkedSpeedRadio.value : 'balanced';

    // Recalculate dynamic settings for non-overridden values
    updateDynamicSettings();

    // Save to localStorage
    localStorage.setItem('planningConfig', JSON.stringify(PLANNING_CONFIG));
    localStorage.setItem('dynamicSettings', JSON.stringify(dynamicSettings));
    localStorage.setItem('planningSpeed', planningSpeed);

    closeSettingsModal();
    
    // Show success message
    showSuccessMessage('Advanced settings saved successfully!');
}

function resetToDefaults() {
    // Clear all override flags
    Object.keys(PLANNING_CONFIG.overrides).forEach(key => {
        PLANNING_CONFIG.overrides[key] = false;
    });

    // Clear input fields
    document.getElementById('maxUnits').value = '';
    document.getElementById('minUnits').value = '';
    document.getElementById('targetUnits').value = '';

    // Recalculate dynamic settings
    updateDynamicSettings();

    showSuccessMessage('Reset to dynamic settings!');
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
}

function initializeDynamicUI() {
    // Set main UI values
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
    
    // Calculate and update displays (totalUnitsNeeded is now calculated from course data)
    updateDynamicSettings();
    
    // Always initialize quarters and render planner on initial load
    initializeQuarters();
    renderPlanner();
}

function updateAcademicSystemUI() {
    // Update graduation timeline label and options based on academic system
    const graduationLabel = getElementByIdWithFallback('graduationTimelineLabelNew', 'graduationTimelineLabel');
    const graduationSelect = getElementByIdWithFallback('quartersToGraduateNew', 'quartersToGraduate');
    const customInput = getElementByIdWithFallback('customQuartersNew', 'customQuarters');
    
    if (currentAcademicSystem === 'semester') {
        // Update label for semester system
        if (graduationLabel) graduationLabel.textContent = 'Semesters to Graduate:';
        
        // Update dropdown options for semesters
        if (graduationSelect) {
            graduationSelect.innerHTML = `
                <option value="4">2 Years (4 semesters)</option>
                <option value="6">3 Years (6 semesters)</option>
                <option value="8" selected>4 Years (8 semesters)</option>
                <option value="10">5 Years (10 semesters)</option>
                <option value="custom">Custom</option>
            `;
        }
        
        // Update placeholder for custom input
        if (customInput) customInput.placeholder = 'Enter semesters';
    } else {
        // Update label for quarter system
        if (graduationLabel) graduationLabel.textContent = 'Quarters to Graduate:';
        
        // Update dropdown options for quarters
        if (graduationSelect) {
            graduationSelect.innerHTML = `
                <option value="8">2 Years (8 quarters)</option>
                <option value="12">3 Years (12 quarters)</option>
                <option value="16" selected>4 Years (16 quarters)</option>
                <option value="20">5 Years (20 quarters)</option>
                <option value="custom">Custom</option>
            `;
        }
        
        // Update placeholder for custom input
        if (customInput) customInput.placeholder = 'Enter quarters';
    }
}

// Dynamic Settings Functions
function calculateDynamicSettings() {
    const quartersToGrad = dynamicSettings.useCustomQuarters ?
        dynamicSettings.customQuarters :
        dynamicSettings.quartersToGraduate;

    // Calculate academic quarters (excluding summer)
    const academicQuarters = currentAcademicSystem === 'quarter' ?
        Math.floor(quartersToGrad * 0.75) : // 3/4 of quarters are academic (no summer)
        quartersToGrad; // All semesters are academic

    // Calculate actual total units from loaded course data
    let actualTotalUnits = 180; // Default fallback
    let courseCount = 0;

    if (ALL_CLASSES_DATA && ALL_CLASSES_DATA.length > 0) {
        // Calculate from actual course data
        const requiredCourses = ALL_CLASSES_DATA.filter(course =>
            course.category === "Required" || course.category === "Capstone" || course.category === "External"
        );

        actualTotalUnits = requiredCourses.reduce((sum, course) => sum + (course.units || 0), 0);
        courseCount = requiredCourses.length;

        // If no required courses found, use all courses
        if (actualTotalUnits === 0) {
            actualTotalUnits = ALL_CLASSES_DATA.reduce((sum, course) => sum + (course.units || 0), 0);
            courseCount = ALL_CLASSES_DATA.length;
        }
    }

    // Calculate units per term based on actual data
    const unitsPerTerm = actualTotalUnits / academicQuarters;

    // Dynamic calculations for balanced distribution
    const minUnits = 12; // Hard-set to 12 units
    const maxUnits = Math.min(22, Math.ceil(unitsPerTerm * 1.06)); // Fine-tuned for balanced distribution
    const targetUnits = Math.round(unitsPerTerm);

    return {
        minUnits,
        maxUnits,
        targetUnits,
        academicQuarters,
        unitsPerTerm: unitsPerTerm.toFixed(1),
        actualTotalUnits,
        courseCount
    };
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

    // If timeline changed, reinitialize quarters
    if (newQuarters !== previousQuarters) {
        initializeQuarters();
        renderPlanner();
    }

    // Calculate and apply dynamic settings based on actual course data
    const calculated = calculateDynamicSettings();

    // Update PLANNING_CONFIG only for non-overridden values
    if (!PLANNING_CONFIG.overrides.MIN_UNITS_PER_QUARTER) {
        PLANNING_CONFIG.MIN_UNITS_PER_QUARTER = calculated.minUnits;
    }
    if (!PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER) {
        PLANNING_CONFIG.MAX_UNITS_PER_QUARTER = calculated.maxUnits;
    }
    if (!PLANNING_CONFIG.overrides.TARGET_UNITS_PER_QUARTER) {
        PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER = calculated.targetUnits;
    }

    // Save settings
    saveDynamicSettings();
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
    
    // Update quarters - use dynamic calculation
    initializeQuarters();
    renderPlanner();
    
    // Recalculate dynamic settings
    updateDynamicSettings();
    
    // Save to localStorage
    localStorage.setItem('academicSystem', currentAcademicSystem);
}

function saveDynamicSettings() {
    localStorage.setItem('dynamicSettings', JSON.stringify(dynamicSettings));
    localStorage.setItem('planningConfig', JSON.stringify(PLANNING_CONFIG));
}

document.addEventListener('DOMContentLoaded', () => {
    // Load saved settings first
    loadSavedSettings();
    
    setupDragAndDrop();
    
    const dataUrlInput = getElementByIdWithFallback('dataUrlNew', 'dataUrl');
    if (dataUrlInput && dataUrlInput.value) {
         loadCourseData();
    } else {
        initializeQuarters(); 
        renderPlanner();
    }
});

function openPlannerTemplate() {
    // Open the planner template in a new tab
    const templateUrl = 'https://docs.google.com/spreadsheets/d/11h6T1080j6RTk9EUBoycZvgq-gj-Add7Y0oL3-ztW70/edit?usp=sharing'; // Replace with actual template URL
    window.open(templateUrl, '_blank', 'noopener,noreferrer');
}

function updateFileNameDisplay(fileName) {
    const fileNameDisplay = document.getElementById('fileNameDisplay');
    if (fileNameDisplay) {
        if (fileName) {
            fileNameDisplay.textContent = fileName;
            fileNameDisplay.classList.add('uploaded');
            fileNameDisplay.style.display = 'inline-block';
        } else {
            fileNameDisplay.textContent = '';
            fileNameDisplay.classList.remove('uploaded');
            fileNameDisplay.style.display = 'none';
        }
    }
}

function handleQuickFileSelect(event) {
    const fileInput = event.target;
    const errorMessage = document.getElementById('errorMessage');
    const uploadButton = fileInput.closest('.upload-icon-button');

    if (fileInput.files.length > 0) {
        const file = fileInput.files[0];

        // Check file extension
        const fileNameStr = file.name.toLowerCase();
        if (!fileNameStr.endsWith('.csv') && !fileNameStr.endsWith('.tsv') && !fileNameStr.endsWith('.txt')) {
            showError("Please select a CSV or TSV file (.csv, .tsv, or .txt extension)");
            fileInput.value = ''; // Clear the input
            // Remove uploaded state
            if (uploadButton) uploadButton.classList.remove('file-uploaded');
            updateFileNameDisplay(null);
            return;
        }

        // Add visual feedback for file upload
        if (uploadButton) uploadButton.classList.add('file-uploaded');

        // Update file name display
        updateFileNameDisplay(file.name);

        // Clear any existing error messages
        errorMessage.style.display = 'none';

        // Don't load the file immediately - wait for Load Data button click
    } else {
        // Remove uploaded state if no file selected
        if (uploadButton) uploadButton.classList.remove('file-uploaded');
        updateFileNameDisplay(null);
    }
}

async function loadCourseDataFromQuickFile(file) {
    try {
        document.body.classList.add('loading');
        
        // Clear all pinned courses and do a hard reset
        pinnedCourses.clear();
        lockedQuarters.clear();
        graph = {};

        // Read file content
        const tsvData = await readFileAsText(file);
        await processTSVData(tsvData);
        
    } catch (error) {
        console.error("Error in loadCourseDataFromQuickFile:", error);
        showError("Error loading file: " + error.message);
        document.body.classList.remove('loading');
    }
}

// Step Navigation Functions
function goToStep(stepNumber) {
    // Update step indicators
    document.querySelectorAll('.step').forEach(step => {
        const currentStep = parseInt(step.dataset.step);
        step.classList.remove('active');
        if (currentStep < stepNumber) {
            step.classList.add('completed');
        } else if (currentStep === stepNumber) {
            step.classList.add('active');
        } else {
            step.classList.remove('completed');
        }
    });

    // Show active step content
    document.querySelectorAll('.step-content').forEach(content => {
        content.classList.remove('active');
        if (parseInt(content.dataset.step) === stepNumber) {
            content.classList.add('active');
        }
    });
}

// Add click handlers for steps and automatic progression
document.addEventListener('DOMContentLoaded', () => {
    // Allow clicking on steps
    document.querySelectorAll('.step').forEach(step => {
        step.addEventListener('click', () => {
            const stepNumber = parseInt(step.dataset.step);
            // Only allow going back to previous steps or current step
            if (stepNumber <= getCurrentStep()) {
                goToStep(stepNumber);
            }
        });
    });

    // Auto-advance after template access
    const templateButton = document.querySelector('.template-tooltip-button');
    if (templateButton) {
        templateButton.addEventListener('click', () => {
            setTimeout(() => goToStep(2), 500);
        });
    }

    // Auto-advance after data load
    const loadDataButton = document.querySelector('.load-data-button');
    if (loadDataButton) {
        const originalOnClick = loadDataButton.onclick;
        loadDataButton.onclick = async function(e) {
            if (originalOnClick) {
                await originalOnClick.call(this, e);
            }
            // Only advance if data was loaded successfully (no error message shown)
            const errorMessage = document.getElementById('errorMessage');
            if (errorMessage && errorMessage.style.display !== 'block') {
                setTimeout(() => goToStep(3), 500);
            }
        };
    }
});

// Helper function to get current active step
function getCurrentStep() {
    const activeStep = document.querySelector('.step.active');
    return activeStep ? parseInt(activeStep.dataset.step) : 1;
}