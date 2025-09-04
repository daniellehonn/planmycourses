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
    MAX_DIFFICULTY_PER_QUARTER: 15,
    TARGET_DIFFICULTY_PER_QUARTER: 12,
    MAX_ATTEMPTS_MIN_UNITS: 5,
    SCORING: {
        UNDER_MIN_UNITS_BONUS: 300,
        MEETS_MIN_UNITS_BONUS: 150,
        OVER_MAX_UNITS_PENALTY: 1000,
        TARGET_DIFFICULTY_BONUS: 100,
        OVER_TARGET_DIFFICULTY_PENALTY: 30,
        WELL_BELOW_MAX_DIFFICULTY_BONUS: 20,
        UNITS_DEVIATION_PENALTY: 10,
        LATER_QUARTER_PENALTY: 15
    },
    // Track which settings are overridden by user
    overrides: {
        MAX_UNITS_PER_QUARTER: false,
        MIN_UNITS_PER_QUARTER: false,
        TARGET_UNITS_PER_QUARTER: false,
        MAX_DIFFICULTY_PER_QUARTER: false,
        TARGET_DIFFICULTY_PER_QUARTER: false
    }
};

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
            if (!fileNameStr.endsWith('.tsv') && !fileNameStr.endsWith('.txt')) {
                throw new Error("Please select a TSV file (.tsv or .txt extension)");
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
        if (!fileNameStr.endsWith('.tsv') && !fileNameStr.endsWith('.txt')) {
            showError("Please select a TSV file (.tsv or .txt extension)");
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

    // Validate required columns (removed "Required or Optional")
    const requiredColumns = ['Course Number', 'Prerequisites', 'Description', 'Units', 'Difficulty'];
    const optionalColumns = ['Taken', 'Corequisites'];
    
    const firstRow = parsedData[0];
    const availableColumns = Object.keys(firstRow);
    
    const missingColumns = requiredColumns.filter(col => !availableColumns.includes(col));
    if (missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}. Required columns are: ${requiredColumns.join(', ')}`);
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
        units: parseInt(row['Units']) || 0, 
        difficulty: parseInt(row['Difficulty']) || 1, 
        category: "Required", // Default all courses to Required since column was removed
        taken: row['Taken'] ? row['Taken'].trim() : '', // Add taken column
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

function parseTSV(tsvText) {
    const lines = tsvText.trim().split('\n').filter(line => line.trim() !== ''); 
    if (lines.length < 1) return [];
    const headers = lines[0].split('\t').map(h => h.trim());
    
    return lines.slice(1).map(line => {
        const values = line.split('\t');
        return headers.reduce((obj, header, index) => {
            obj[header] = values[index] ? values[index].trim() : '';
            return obj;
        }, {});
    });
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
                difficulty: 0
            });
        });
    }
    const unassignedClassesIds = ALL_CLASSES_DATA.map(c => c.id);
    quartersData.unshift({ 
        id: "unassigned",
        name: "Unassigned Classes",
        classes: unassignedClassesIds,
        pinnedClasses: [], // Unassigned can't have pinned courses
        units: 0, 
        difficulty: 0 
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
                                     <span class="quarter-units" id="difficulty-${quarter.id}">${quarter.difficulty} difficulty</span>
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
    addDragDropListeners();
    updateAllUnitCounts(); 
    updateAllDifficultyCounts(); 
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

    card.innerHTML = `
        ${classData.name}
        <span class="units">(${classData.units} units, Diff: <span class="difficulty-value" data-class-id="${classData.id}" data-field="difficulty">${classData.difficulty}</span>)</span>
        <span class="tooltip">${tooltipContent}</span>
    `;
    
    card.appendChild(pinButton);
    
    // Add double-click event listener to the card for editing
    card.addEventListener('dblclick', handleCardDoubleClick);
    
    // Apply custom color if set
    if (classData.color && classData.color !== '#ffffff') {
        card.style.backgroundColor = classData.color;
        // Adjust text color for better contrast if background is dark
        const r = parseInt(classData.color.slice(1, 3), 16);
        const g = parseInt(classData.color.slice(3, 5), 16);
        const b = parseInt(classData.color.slice(5, 7), 16);
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        if (brightness < 128) {
            card.style.color = 'white';
            card.style.borderColor = '#4b5563';
            // Apply white text to all text elements for better visibility
            const textElements = card.querySelectorAll('.units, .difficulty-value, .tooltip, .course-title, .prereq-label, .coreq-label, .prereq-list, .coreq-list, .planning-note');
            textElements.forEach(el => {
                if (el) el.style.color = 'white';
            });
        } else {
            // Reset to default colors for light backgrounds
            card.style.color = '';
            card.style.borderColor = '';
            const textElements = card.querySelectorAll('.units, .difficulty-value, .tooltip, .course-title, .prereq-label, .coreq-label, .prereq-list, .coreq-list, .planning-note');
            textElements.forEach(el => {
                if (el) el.style.color = '';
            });
        }
    }
    
    return card;
}

function handleFieldEdit(event) {
    const span = event.target;
    const classId = span.dataset.classId;
    const field = span.dataset.field;
    const newValue = span.textContent.trim();
    
    if (field === 'difficulty') {
        const newDifficulty = parseInt(newValue);
        if (isNaN(newDifficulty) || newDifficulty < 1 || newDifficulty > 8) {
            alert('Difficulty must be a number between 1 and 8');
            span.textContent = ALL_CLASSES_DATA.find(c => c.id === classId)?.difficulty || 1;
            return;
        }
        
        // Update the course data
        const course = ALL_CLASSES_DATA.find(c => c.id === classId);
        if (course) {
            course.difficulty = newDifficulty;
            // Re-render to update calculations
            renderPlanner();
        }
    }
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
                    <label for="edit-difficulty">Difficulty (1-8)</label>
                    <input type="number" id="edit-difficulty" value="${course.difficulty}" min="1" max="8">
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
        course.difficulty = parseInt(document.getElementById('edit-difficulty').value) || course.difficulty;
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

    // Check difficulty limits
    const currentDifficulty = targetQuarter.difficulty;
    const newDifficulty = currentDifficulty + (course.difficulty || 1);
    if (newDifficulty > PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER) {
        return { isValid: false, reason: `Would exceed max difficulty (${PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER}). Current: ${currentDifficulty}, Adding: ${course.difficulty}` };
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

function updateQuarterDifficulty(quarterId) {
    const quarter = getQuarterById(quarterId);
    if (!quarter || quarter.id === 'unassigned') return;

    let totalDifficulty = 0;
    quarter.classes.forEach(classId => {
        const classData = findClassById(classId);
        if (classData) {
            totalDifficulty += (classData.difficulty || 1); 
        }
    });
    quarter.difficulty = totalDifficulty;
    
    const difficultyDisplay = document.getElementById(`difficulty-${quarter.id}`);
    if (difficultyDisplay) {
        difficultyDisplay.textContent = `${totalDifficulty} difficulty`;
    }
}

function updateAllDifficultyCounts() {
     quartersData.forEach(q => {
        if (q.id !== 'unassigned') {
            updateQuarterDifficulty(q.id);
        }
    });
}

function getAvailableCoursesForPlanning(completedCoursesInPreviousQuarters, coursesAlreadyInCurrentQuarterPlan, allGraphNodes) {
    return Object.values(allGraphNodes)
        .filter(node => {
            if (node.placed) return false; 
            if (coursesAlreadyInCurrentQuarterPlan.has(node.course.id)) return false;
            if (isPinnedCourse(node.course.id)) return false; // Exclude pinned courses from auto-planning
            return node.prerequisites.every(prereqId => completedCoursesInPreviousQuarters.has(prereqId) || !graph[prereqId] /* allow if prereq isn't a core plannable course in graph */);
        })
        .sort((nodeA, nodeB) => {
            if (nodeA.originalOrder !== nodeB.originalOrder) {
                return nodeA.originalOrder - nodeB.originalOrder;
            }
            if (nodeB.dependents.length !== nodeA.dependents.length) {
                return nodeB.dependents.length - nodeA.dependents.length;
            }
            const diffA = nodeA.course.difficulty || 1;
            const diffB = nodeB.course.difficulty || 1;
            if (diffA !== diffB) {
                return diffA - diffB;
            }
            return nodeA.course.id.localeCompare(nodeB.course.id);
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

    return graph;
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
            quarter.difficulty = 0;
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
                    quarter.difficulty += (classData.difficulty || 1);
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

function canPlaceCourseInQuarter(course, quarter) {
    return quarter.units + course.units <= PLANNING_CONFIG.MAX_UNITS_PER_QUARTER &&
           quarter.difficulty + (course.difficulty || 1) <= PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER;
}

function canPlaceCourseInQuarterForPlanning(course, quarter) {
    // For planning purposes, we need to check if there's room considering pinned courses
    // are already placed and counted in quarter.units and quarter.difficulty
    return canPlaceCourseInQuarter(course, quarter);
}

function addCourseToQuarter(course, quarter, courseNode, coursesInQuarter) {
    quarter.classes.push(course.id);
    courseNode.placed = true;
    coursesInQuarter.add(course.id);
    quarter.units += course.units;
    quarter.difficulty += (course.difficulty || 1);
}

function primaryCoursePlacement(quarter, completedCourses, coursesInQuarter, graph) {
    while (true) {
        const availableCourseNodes = getAvailableCoursesForPlanning(
            completedCourses,
            coursesInQuarter,
            graph
        );

        if (availableCourseNodes.length === 0) break;

        let coursePlacedThisIteration = false;
        for (const courseNode of availableCourseNodes) {
            const course = courseNode.course;
            
            // Check if this course has corequisites
            if (courseNode.corequisites.length > 0) {
                const coreqGroup = getCorequisiteGroup(course.id, graph);
                
                // Check if all corequisites in the group are available for placement
                const allCoreqsAvailable = coreqGroup.every(coreqId => {
                    const coreqNode = graph[coreqId];
                    if (!coreqNode || coreqNode.placed) return false;
                    
                    // Check if prerequisites are satisfied for each corequisite
                    return checkPrerequisitesSatisfied(coreqNode, completedCourses, graph);
                });
                
                if (allCoreqsAvailable && canPlaceCorequisiteGroup(coreqGroup, quarter, graph)) {
                    placeCorequisiteGroup(coreqGroup, quarter, graph, coursesInQuarter);
                    coursePlacedThisIteration = true;
                    break;
                }
            } else {
                // Regular single course placement
                if (canPlaceCourseInQuarterForPlanning(course, quarter)) {
                    addCourseToQuarter(course, quarter, courseNode, coursesInQuarter);
                    coursePlacedThisIteration = true;
                    break;
                }
            }
        }
        if (!coursePlacedThisIteration) break;
    }
}

function secondaryCoursePlacement(quarter, completedCourses, coursesInQuarter, graph) {
    if (quarter.units >= PLANNING_CONFIG.MIN_UNITS_PER_QUARTER) return;

    let attempts = 0;
    while (quarter.units < PLANNING_CONFIG.MIN_UNITS_PER_QUARTER && attempts < PLANNING_CONFIG.MAX_ATTEMPTS_MIN_UNITS) {
        const availableForMinFill = getAvailableCoursesForPlanning(
            completedCourses,
            coursesInQuarter,
            graph
        );

        if (availableForMinFill.length === 0) break;

        let courseAddedToMeetMin = false;
        for (const courseNode of availableForMinFill) {
            const course = courseNode.course;
            if (canPlaceCourseInQuarterForPlanning(course, quarter) && !coursesInQuarter.has(course.id)) {
                addCourseToQuarter(course, quarter, courseNode, coursesInQuarter);
                courseAddedToMeetMin = true;
                break;
            }
        }
        if (!courseAddedToMeetMin) break;
        attempts++;
    }
}

function tertiaryCoursePlacement(quarter, completedCourses, coursesInQuarter, graph) {
    // Third phase: Fill quarters to max units even if difficulty is high
    // This helps utilize available capacity when difficulty constraints are blocking placement
    
    let attempts = 0;
    const maxAttempts = 10;
    
    while (quarter.units < PLANNING_CONFIG.MAX_UNITS_PER_QUARTER && attempts < maxAttempts) {
        const availableForFill = getAvailableCoursesForPlanning(
            completedCourses,
            coursesInQuarter,
            graph
        );

        if (availableForFill.length === 0) break;

        let courseAddedToFill = false;
        for (const courseNode of availableForFill) {
            const course = courseNode.course;
            
            // Only check units constraint, ignore difficulty for this phase
            const wouldExceedUnits = quarter.units + course.units > PLANNING_CONFIG.MAX_UNITS_PER_QUARTER;
            
            if (!wouldExceedUnits && !coursesInQuarter.has(course.id)) {
                addCourseToQuarter(course, quarter, courseNode, coursesInQuarter);
                courseAddedToFill = true;
                break;
            }
        }
        if (!courseAddedToFill) break;
        attempts++;
    }
}

function calculateQuarterScore(quarter, course, quarterIndex) {
    const newQuarterUnits = quarter.units + course.units;
    const newQuarterDifficulty = quarter.difficulty + (course.difficulty || 1);
    let score = 0;

    // Units scoring
    if (quarter.units < PLANNING_CONFIG.MIN_UNITS_PER_QUARTER) {
        score += PLANNING_CONFIG.SCORING.UNDER_MIN_UNITS_BONUS;
        if (newQuarterUnits >= PLANNING_CONFIG.MIN_UNITS_PER_QUARTER) {
            score += PLANNING_CONFIG.SCORING.MEETS_MIN_UNITS_BONUS;
        }
    } else if (newQuarterUnits > PLANNING_CONFIG.MAX_UNITS_PER_QUARTER) {
        score -= PLANNING_CONFIG.SCORING.OVER_MAX_UNITS_PENALTY;
    }

    // Difficulty scoring
    if (newQuarterDifficulty <= PLANNING_CONFIG.TARGET_DIFFICULTY_PER_QUARTER) {
        score += PLANNING_CONFIG.SCORING.TARGET_DIFFICULTY_BONUS;
    } else {
        score -= (newQuarterDifficulty - PLANNING_CONFIG.TARGET_DIFFICULTY_PER_QUARTER) * PLANNING_CONFIG.SCORING.OVER_TARGET_DIFFICULTY_PENALTY;
    }

    if (newQuarterDifficulty < PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER - 3) {
        score += PLANNING_CONFIG.SCORING.WELL_BELOW_MAX_DIFFICULTY_BONUS;
    }

    // Target units deviation penalty
    score -= Math.abs(newQuarterUnits - PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER) * PLANNING_CONFIG.SCORING.UNITS_DEVIATION_PENALTY;
    
    // Later quarter penalty
    score -= quarterIndex * PLANNING_CONFIG.SCORING.LATER_QUARTER_PENALTY;

    return score;
}

function checkPrerequisitesSatisfied(courseNode, completedBeforeQuarter, graph) {
    return courseNode.prerequisites.every(prereqId => 
        completedBeforeQuarter.has(prereqId) || !graph[prereqId]
    );
}

function findBestQuarterForCourse(courseNode, academicQuarters, graph) {
    const course = courseNode.course;
    let bestQuarter = null;
    let bestScore = -Infinity;

    // Get summer courses to include as completed prerequisites
    const summerQuarters = quartersData.filter(q => 
        q.id !== 'unassigned' && q.name.toLowerCase().includes('summer')
    );
    const summerCourses = new Set();
    summerQuarters.forEach(summerQuarter => {
        summerQuarter.classes.forEach(courseId => summerCourses.add(courseId));
    });

    for (let qIdx = 0; qIdx < academicQuarters.length; qIdx++) {
        const potentialQuarter = academicQuarters[qIdx];

        if (!canPlaceCourseInQuarterForPlanning(course, potentialQuarter)) {
            continue;
        }

        const coursesCompletedBeforePotentialQuarter = new Set();
        
        // Include summer courses as completed
        summerCourses.forEach(courseId => coursesCompletedBeforePotentialQuarter.add(courseId));
        
        // Include courses from previous academic quarters
        for (let prevQIdx = 0; prevQIdx < qIdx; prevQIdx++) {
            academicQuarters[prevQIdx].classes.forEach(cId => coursesCompletedBeforePotentialQuarter.add(cId));
        }

        if (!checkPrerequisitesSatisfied(courseNode, coursesCompletedBeforePotentialQuarter, graph)) {
            continue;
        }

        const score = calculateQuarterScore(potentialQuarter, course, qIdx);
        if (score > bestScore) {
            bestScore = score;
            bestQuarter = potentialQuarter;
        }
    }

    return bestQuarter;
}

function sortUnplacedCourses(unplacedCourseNodes, graph) {
    return unplacedCourseNodes.sort((a, b) => {
        if (a.originalOrder !== b.originalOrder) return a.originalOrder - b.originalOrder;
        
        const aPrereqsUnmet = a.prerequisites.filter(pId => graph[pId] && !graph[pId].placed).length;
        const bPrereqsUnmet = b.prerequisites.filter(pId => graph[pId] && !graph[pId].placed).length;
        if (aPrereqsUnmet !== bPrereqsUnmet) return aPrereqsUnmet - bPrereqsUnmet;
        
        return (a.course.difficulty || 1) - (b.course.difficulty || 1);
    });
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
    
    // Check if it's a capacity issue (units or difficulty)
    const course = courseNode.course;
    let hasUnitsCapacity = false;
    let hasDifficultyCapacity = false;
    
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
            const wouldExceedDifficulty = quarter.difficulty + (course.difficulty || 1) > PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER;
            
            if (!wouldExceedUnits) hasUnitsCapacity = true;
            if (!wouldExceedDifficulty) hasDifficultyCapacity = true;
        }
        
        // Add this quarter's courses to completed for next iteration
        quarter.classes.forEach(c => tempCompleted.add(c));
    }
    
    if (hasUnitsCapacity && !hasDifficultyCapacity) {
        return "Blocked by difficulty constraints. Try increasing max difficulty in Advanced Settings.";
    } else if (!hasUnitsCapacity && hasDifficultyCapacity) {
        return "Blocked by unit capacity. Try increasing max units in Advanced Settings.";
    } else if (!hasUnitsCapacity && !hasDifficultyCapacity) {
        return "Blocked by both unit and difficulty constraints.";
    }
    
    return "No suitable quarter (capacity/schedule).";
}

function fallbackCoursePlacement(graph, academicQuarters) {
    let unplacedCourseNodes = Object.values(graph).filter(node => 
        !node.placed && (node.course.category === "Required" || node.course.category === "Capstone" || node.course.category === "External")
    );
    
    let fallbackIterations = 0;
    const MAX_FALLBACK_ITERATIONS = unplacedCourseNodes.length + academicQuarters.length + 5;

    // Get summer courses to include as completed prerequisites
    const summerQuarters = quartersData.filter(q => 
        q.id !== 'unassigned' && q.name.toLowerCase().includes('summer')
    );
    const summerCourses = new Set();
    summerQuarters.forEach(summerQuarter => {
        summerQuarter.classes.forEach(courseId => summerCourses.add(courseId));
    });

    while (unplacedCourseNodes.length > 0 && fallbackIterations < MAX_FALLBACK_ITERATIONS) {
        let courseWasPlacedInFallbackPass = false;
        unplacedCourseNodes = sortUnplacedCourses(unplacedCourseNodes, graph);

        for (const courseNode of unplacedCourseNodes) {
            if (courseNode.placed) continue;

            // Check if this course has corequisites
            if (courseNode.corequisites.length > 0) {
                const coreqGroup = getCorequisiteGroup(courseNode.course.id, graph);
                
                // Check if all corequisites in the group are unplaced
                const allCoreqsUnplaced = coreqGroup.every(coreqId => {
                    const coreqNode = graph[coreqId];
                    return coreqNode && !coreqNode.placed;
                });
                
                if (allCoreqsUnplaced) {
                    // Find best quarter for the entire corequisite group
                    let bestQuarter = null;
                    let bestScore = -Infinity;
                    
                    for (let qIdx = 0; qIdx < academicQuarters.length; qIdx++) {
                        const potentialQuarter = academicQuarters[qIdx];
                        
                        if (!canPlaceCorequisiteGroup(coreqGroup, potentialQuarter, graph)) {
                            continue;
                        }
                        
                        const coursesCompletedBeforePotentialQuarter = new Set();
                        
                        // Include summer courses as completed
                        summerCourses.forEach(courseId => coursesCompletedBeforePotentialQuarter.add(courseId));
                        
                        // Include courses from previous academic quarters
                        for (let prevQIdx = 0; prevQIdx < qIdx; prevQIdx++) {
                            academicQuarters[prevQIdx].classes.forEach(cId => coursesCompletedBeforePotentialQuarter.add(cId));
                        }
                        
                        // Check if all courses in the group have their prerequisites satisfied
                        const allPrereqsSatisfied = coreqGroup.every(coreqId => {
                            const coreqNode = graph[coreqId];
                            return checkPrerequisitesSatisfied(coreqNode, coursesCompletedBeforePotentialQuarter, graph);
                        });
                        
                        if (allPrereqsSatisfied) {
                            // Calculate average score for the group
                            let groupScore = 0;
                            coreqGroup.forEach(coreqId => {
                                groupScore += calculateQuarterScore(potentialQuarter, graph[coreqId].course, qIdx);
                            });
                            groupScore /= coreqGroup.length;
                            
                            if (groupScore > bestScore) {
                                bestScore = groupScore;
                                bestQuarter = potentialQuarter;
                            }
                        }
                    }
                    
                    if (bestQuarter) {
                        // Place the entire corequisite group
                        coreqGroup.forEach(coreqId => {
                            const course = graph[coreqId].course;
                            bestQuarter.classes.push(course.id);
                            graph[coreqId].placed = true;
                            bestQuarter.units += course.units;
                            bestQuarter.difficulty += (course.difficulty || 1);
                        });
                        courseWasPlacedInFallbackPass = true;
                        break;
                    }
                }
            } else {
                // Regular single course fallback placement
                const bestQuarter = findBestQuarterForCourse(courseNode, academicQuarters, graph);
                if (bestQuarter) {
                    const course = courseNode.course;
                    bestQuarter.classes.push(course.id);
                    courseNode.placed = true;
                    bestQuarter.units += course.units;
                    bestQuarter.difficulty += (course.difficulty || 1);
                    courseWasPlacedInFallbackPass = true;
                    break;
                }
            }
        }

        unplacedCourseNodes = Object.values(graph).filter(node => 
            !node.placed && (node.course.category === "Required" || node.course.category === "Capstone" || node.course.category === "External")
        );

        if (!courseWasPlacedInFallbackPass && unplacedCourseNodes.length > 0) {
            unplacedCourseNodes.forEach(node => {
                if (!node.unassignedReason) {
                    node.unassignedReason = generateUnassignedReason(node, academicQuarters, graph);
                }
            });
            break;
        }
        fallbackIterations++;
    }

    if (fallbackIterations >= MAX_FALLBACK_ITERATIONS && unplacedCourseNodes.length > 0) {
        unplacedCourseNodes.forEach(node => {
            if (!node.unassignedReason) node.unassignedReason = "Max planning iterations reached.";
        });
    }
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

    graph = initializePlanningGraph();
    const academicQuarters = getAcademicQuartersForPlanning();

    // Initialize completed courses with courses pinned in summer quarters
    let completedCourses = new Set();
    
    // Add courses from summer quarters as completed prerequisites
    const summerQuarters = quartersData.filter(q => 
        q.id !== 'unassigned' && q.name.toLowerCase().includes('summer')
    );
    
    summerQuarters.forEach(summerQuarter => {
        summerQuarter.classes.forEach(courseId => {
            completedCourses.add(courseId);
            // Mark summer courses as placed in the graph so they won't be auto-planned
            if (graph[courseId]) {
                graph[courseId].placed = true;
            }
        });
    });
    
    // Mark courses in locked quarters as placed so they won't be auto-planned
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned' && isQuarterLocked(quarter.id)) {
            quarter.classes.forEach(courseId => {
                if (graph[courseId]) {
                    graph[courseId].placed = true;
                }
                // Also add to completed courses to serve as prerequisites
                completedCourses.add(courseId);
            });
        }
    });
    
    // Main planning loop for each quarter
    for (const quarter of academicQuarters) {
        let coursesAddedToThisQuarter = new Set();
        
        // Add pinned courses to the completed courses tracking for this quarter
        quarter.pinnedClasses.forEach(courseId => {
            coursesAddedToThisQuarter.add(courseId);
            // Mark pinned courses as placed in the graph
            if (graph[courseId]) {
                graph[courseId].placed = true;
            }
        });

        // Primary course placement (respects both units and difficulty constraints)
        primaryCoursePlacement(quarter, completedCourses, coursesAddedToThisQuarter, graph);

        // Secondary placement to meet minimum units (respects both constraints)
        secondaryCoursePlacement(quarter, completedCourses, coursesAddedToThisQuarter, graph);

        // Tertiary placement to maximize unit utilization (ignores difficulty constraints)
        tertiaryCoursePlacement(quarter, completedCourses, coursesAddedToThisQuarter, graph);

        // Update completed courses (including both pinned and auto-placed)
        quarter.classes.forEach(courseId => completedCourses.add(courseId));
    }

    // Fallback placement for remaining courses
    fallbackCoursePlacement(graph, academicQuarters);

    // Final cleanup: assign remaining courses to quarters with most available capacity
    finalCleanupPlacement(graph, academicQuarters);

    // Finalize unassigned courses
    finalizeUnassignedCourses(graph);

    renderPlanner();
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

    // Create TSV content without the "Required or Optional" column
    let tsvContent = "Taken\tCourse Number\tPrerequisites\tCorequisites\tDescription\tUnits\tDifficulty\n";
    
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
        
        // Escape tabs and newlines in description
        const description = (courseData.description || '').replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
        
        // Add row to TSV (removed Required or Optional column)
        tsvContent += `${takenValue}\t${courseData.name}\t${prerequisites}\t${corequisites}\t${description}\t${courseData.units}\t${courseData.difficulty}\n`;
    });
    
    // Create and download the file
    const blob = new Blob([tsvContent], { type: 'text/tab-separated-values;charset=utf-8;' });
    const link = document.createElement('a');
    
    if (link.download !== undefined) {
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `course_plan_${new Date().toISOString().split('T')[0]}.tsv`);
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
                    targetQuarter.difficulty += (courseData.difficulty || 1);
                    
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
    updateAllDifficultyCounts();
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
    const maxDifficultyInput = document.getElementById('maxDifficulty');
    const targetDifficultyInput = document.getElementById('targetDifficulty');
    
    // Only show values if they are overridden
    maxUnitsInput.value = PLANNING_CONFIG.overrides.MAX_UNITS_PER_QUARTER ? 
        PLANNING_CONFIG.MAX_UNITS_PER_QUARTER : '';
    minUnitsInput.value = PLANNING_CONFIG.overrides.MIN_UNITS_PER_QUARTER ? 
        PLANNING_CONFIG.MIN_UNITS_PER_QUARTER : '';
    targetUnitsInput.value = PLANNING_CONFIG.overrides.TARGET_UNITS_PER_QUARTER ? 
        PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER : '';
    maxDifficultyInput.value = PLANNING_CONFIG.overrides.MAX_DIFFICULTY_PER_QUARTER ? 
        PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER : '';
    targetDifficultyInput.value = PLANNING_CONFIG.overrides.TARGET_DIFFICULTY_PER_QUARTER ? 
        PLANNING_CONFIG.TARGET_DIFFICULTY_PER_QUARTER : '';
    
    // Update dynamic values display
    const calculated = calculateDynamicSettings();
    // updateDynamicDisplays(calculated); // Removed - UI elements no longer exist
}

function saveSettings() {
    // Get values from advanced settings
    const maxUnitsInput = document.getElementById('maxUnits');
    const minUnitsInput = document.getElementById('minUnits');
    const targetUnitsInput = document.getElementById('targetUnits');
    const maxDifficultyInput = document.getElementById('maxDifficulty');
    const targetDifficultyInput = document.getElementById('targetDifficulty');
    
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
    
    // Max Difficulty
    if (maxDifficultyInput.value.trim() !== '') {
        newConfig.MAX_DIFFICULTY_PER_QUARTER = parseInt(maxDifficultyInput.value);
        newOverrides.MAX_DIFFICULTY_PER_QUARTER = true;
    } else {
        newOverrides.MAX_DIFFICULTY_PER_QUARTER = false;
    }
    
    // Target Difficulty
    if (targetDifficultyInput.value.trim() !== '') {
        newConfig.TARGET_DIFFICULTY_PER_QUARTER = parseInt(targetDifficultyInput.value);
        newOverrides.TARGET_DIFFICULTY_PER_QUARTER = true;
    } else {
        newOverrides.TARGET_DIFFICULTY_PER_QUARTER = false;
    }
    
    // Validate settings
    const finalMinUnits = newOverrides.MIN_UNITS_PER_QUARTER ? 
        newConfig.MIN_UNITS_PER_QUARTER : PLANNING_CONFIG.MIN_UNITS_PER_QUARTER;
    const finalMaxUnits = newOverrides.MAX_UNITS_PER_QUARTER ? 
        newConfig.MAX_UNITS_PER_QUARTER : PLANNING_CONFIG.MAX_UNITS_PER_QUARTER;
    const finalTargetUnits = newOverrides.TARGET_UNITS_PER_QUARTER ? 
        newConfig.TARGET_UNITS_PER_QUARTER : PLANNING_CONFIG.TARGET_UNITS_PER_QUARTER;
    const finalTargetDifficulty = newOverrides.TARGET_DIFFICULTY_PER_QUARTER ? 
        newConfig.TARGET_DIFFICULTY_PER_QUARTER : PLANNING_CONFIG.TARGET_DIFFICULTY_PER_QUARTER;
    const finalMaxDifficulty = newOverrides.MAX_DIFFICULTY_PER_QUARTER ? 
        newConfig.MAX_DIFFICULTY_PER_QUARTER : PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER;
    
    if (finalMinUnits > finalMaxUnits) {
        alert('Minimum units cannot be greater than maximum units.');
        return;
    }
    
    if (finalTargetUnits > finalMaxUnits) {
        alert('Target units cannot be greater than maximum units.');
        return;
    }
    
    if (finalTargetDifficulty > finalMaxDifficulty) {
        alert('Target difficulty cannot be greater than maximum difficulty.');
        return;
    }
    
    // Apply settings
    Object.assign(PLANNING_CONFIG, newConfig);
    Object.assign(PLANNING_CONFIG.overrides, newOverrides);
    
    // Recalculate dynamic settings for non-overridden values
    updateDynamicSettings();
    
    // Save to localStorage
    localStorage.setItem('planningConfig', JSON.stringify(PLANNING_CONFIG));
    localStorage.setItem('dynamicSettings', JSON.stringify(dynamicSettings));
    
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
    document.getElementById('maxDifficulty').value = '';
    document.getElementById('targetDifficulty').value = '';
    
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

// New corequisite handling functions
function getCorequisiteGroup(courseId, graph) {
    const visited = new Set();
    const group = new Set();
    
    function collectCorequisites(currentId) {
        if (visited.has(currentId) || !graph[currentId]) return;
        
        visited.add(currentId);
        group.add(currentId);
        
        // Add all corequisites of the current course
        graph[currentId].corequisites.forEach(coreqId => {
            if (graph[coreqId] && !visited.has(coreqId)) {
                collectCorequisites(coreqId);
            }
        });
        
        // Also check if any other courses have this course as a corequisite
        Object.values(graph).forEach(node => {
            if (!visited.has(node.course.id) && node.corequisites.includes(currentId)) {
                collectCorequisites(node.course.id);
            }
        });
    }
    
    collectCorequisites(courseId);
    return Array.from(group);
}

function canPlaceCorequisiteGroup(courseIds, quarter, graph) {
    let totalUnits = 0;
    let totalDifficulty = 0;
    
    courseIds.forEach(courseId => {
        const course = graph[courseId].course;
        totalUnits += course.units;
        totalDifficulty += (course.difficulty || 1);
    });
    
    return (quarter.units + totalUnits <= PLANNING_CONFIG.MAX_UNITS_PER_QUARTER) &&
           (quarter.difficulty + totalDifficulty <= PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER);
}

function placeCorequisiteGroup(courseIds, quarter, graph, coursesInQuarter) {
    courseIds.forEach(courseId => {
        if (!graph[courseId].placed) {
            const course = graph[courseId].course;
            addCourseToQuarter(course, quarter, graph[courseId], coursesInQuarter);
        }
    });
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
    
    // Calculate actual total units and difficulty from loaded course data
    let actualTotalUnits = 180; // Default fallback
    let actualTotalDifficulty = 0;
    let courseCount = 0;
    
    if (ALL_CLASSES_DATA && ALL_CLASSES_DATA.length > 0) {
        // Calculate from actual course data
        const requiredCourses = ALL_CLASSES_DATA.filter(course => 
            course.category === "Required" || course.category === "Capstone" || course.category === "External"
        );
        
        actualTotalUnits = requiredCourses.reduce((sum, course) => sum + (course.units || 0), 0);
        actualTotalDifficulty = requiredCourses.reduce((sum, course) => sum + (course.difficulty || 1), 0);
        courseCount = requiredCourses.length;
        
        // If no required courses found, use all courses
        if (actualTotalUnits === 0) {
            actualTotalUnits = ALL_CLASSES_DATA.reduce((sum, course) => sum + (course.units || 0), 0);
            actualTotalDifficulty = ALL_CLASSES_DATA.reduce((sum, course) => sum + (course.difficulty || 1), 0);
            courseCount = ALL_CLASSES_DATA.length;
        }
    }
    
    // Calculate units per term based on actual data
    const unitsPerTerm = actualTotalUnits / academicQuarters;
    
    // Dynamic calculations for balanced distribution
    const minUnits = 12; // Hard-set to 12 units
    const maxUnits = Math.min(22, Math.ceil(unitsPerTerm * 1.06)); // Fine-tuned for balanced distribution
    const targetUnits = Math.round(unitsPerTerm);
    
    // Difficulty calculations based on actual course difficulty data
    const difficultyPerTerm = actualTotalDifficulty / academicQuarters;
    const targetDifficulty = Math.round(difficultyPerTerm);
    const maxDifficulty = Math.round(difficultyPerTerm * 1.4);
    
    return {
        minUnits,
        maxUnits,
        targetUnits,
        targetDifficulty,
        maxDifficulty,
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
    if (!PLANNING_CONFIG.overrides.TARGET_DIFFICULTY_PER_QUARTER) {
        PLANNING_CONFIG.TARGET_DIFFICULTY_PER_QUARTER = calculated.targetDifficulty;
    }
    if (!PLANNING_CONFIG.overrides.MAX_DIFFICULTY_PER_QUARTER) {
        PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER = calculated.maxDifficulty;
    }
    
    // Update UI displays
    // updateDynamicDisplays(calculated); // Removed - UI elements no longer exist
    
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

function finalCleanupPlacement(graph, academicQuarters) {
    // Final phase: Assign any remaining unassigned courses to quarters with most available capacity
    // This runs after all other placement attempts and doesn't change existing assignments
    // DISREGARDS MAX UNITS - will place courses even if they exceed normal unit limits
    
    const unplacedCourses = Object.values(graph).filter(node => 
        !node.placed && (node.course.category === "Required" || node.course.category === "Capstone" || node.course.category === "External")
    );
    
    if (unplacedCourses.length === 0) return;
    
    // Include summer courses as completed prerequisites
    const summerQuarters = quartersData.filter(q => 
        q.id !== 'unassigned' && q.name.toLowerCase().includes('summer')
    );
    const summerCourses = new Set();
    summerQuarters.forEach(summerQuarter => {
        summerQuarter.classes.forEach(courseId => summerCourses.add(courseId));
    });
    
    // Sort unplaced courses by priority (original order, then by prerequisites)
    const sortedUnplacedCourses = unplacedCourses.sort((a, b) => {
        if (a.originalOrder !== b.originalOrder) return a.originalOrder - b.originalOrder;
        
        const aPrereqsUnmet = a.prerequisites.filter(pId => graph[pId] && !graph[pId].placed).length;
        const bPrereqsUnmet = b.prerequisites.filter(pId => graph[pId] && !graph[pId].placed).length;
        return aPrereqsUnmet - bPrereqsUnmet;
    });
    
    for (const courseNode of sortedUnplacedCourses) {
        if (courseNode.placed) continue; // Skip if already placed
        
        const course = courseNode.course;
        let bestQuarter = null;
        let bestScore = -Infinity;
        
        // Check each quarter to find the best fit
        for (let qIdx = 0; qIdx < academicQuarters.length; qIdx++) {
            const quarter = academicQuarters[qIdx];
            
            // Check if prerequisites are satisfied for this quarter
            const coursesCompletedBeforeQuarter = new Set();
            
            // Include summer courses as completed
            summerCourses.forEach(courseId => coursesCompletedBeforeQuarter.add(courseId));
            
            // Include courses from previous quarters
            for (let prevQIdx = 0; prevQIdx < qIdx; prevQIdx++) {
                academicQuarters[prevQIdx].classes.forEach(cId => coursesCompletedBeforeQuarter.add(cId));
            }
            
            // Check if prerequisites are satisfied
            const prereqsSatisfied = checkPrerequisitesSatisfied(courseNode, coursesCompletedBeforeQuarter, graph);
            if (!prereqsSatisfied) continue;
            
            // Calculate available capacity score (higher is better)
            // NO LONGER CHECK UNITS CONSTRAINT - just prefer quarters with fewer units
            const difficultyRemaining = Math.max(0, PLANNING_CONFIG.MAX_DIFFICULTY_PER_QUARTER - quarter.difficulty);
            
            // Prioritize quarters with fewer current units and more difficulty capacity
            // Also prefer earlier quarters (lower qIdx)
            const capacityScore = (-quarter.units * 2) + (difficultyRemaining * 5) - (qIdx * 1);
            
            // Accept ANY quarter where prerequisites are satisfied (no unit limit check)
            if (capacityScore > bestScore) {
                bestScore = capacityScore;
                bestQuarter = quarter;
            }
        }
        
        // Place the course in the best available quarter (even if it exceeds unit limits)
        if (bestQuarter) {
            bestQuarter.classes.push(course.id);
            courseNode.placed = true;
            bestQuarter.units += course.units;
            bestQuarter.difficulty += (course.difficulty || 1);
            
            // Clear any unassigned reason since we successfully placed it
            courseNode.unassignedReason = '';
        }
    }
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
        if (!fileNameStr.endsWith('.tsv') && !fileNameStr.endsWith('.txt')) {
            showError("Please select a TSV file (.tsv or .txt extension)");
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