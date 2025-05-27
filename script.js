let ALL_CLASSES_DATA = [];
let quartersData = [];
let draggedClassId = null;
let graph = {};
let pinnedCourses = new Set(); // Track which courses are pinned
let lockedQuarters = new Set(); // Track which quarters are locked

// Configuration constants for course planning optimization
const PLANNING_CONFIG = {
    MAX_UNITS_PER_QUARTER: 15,
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
    }
};

async function loadCourseData() {
    const urlInput = document.getElementById('dataUrl');
    const errorMessage = document.getElementById('errorMessage');
    const url = urlInput.value.trim();

    if (!url) {
        showError("Please enter a valid URL");
        return;
    }

    try {
        document.body.classList.add('loading');
        errorMessage.style.display = 'none';

        // Clear all pinned courses and do a hard reset
        pinnedCourses.clear();
        lockedQuarters.clear();
        graph = {};

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch data (status: ${response.status})`);
        }

        const tsvData = await response.text();
        await processTSVData(tsvData);
        
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

    // Validate required columns
    const requiredColumns = ['Course Number', 'Prerequisites', 'Description', 'Units', 'Required or Optional', 'Difficulty'];
    const optionalColumns = ['Taken'];
    
    const firstRow = parsedData[0];
    const availableColumns = Object.keys(firstRow);
    
    const missingColumns = requiredColumns.filter(col => !availableColumns.includes(col));
    if (missingColumns.length > 0) {
        throw new Error(`Missing required columns: ${missingColumns.join(', ')}. Required columns are: ${requiredColumns.join(', ')}`);
    }

    ALL_CLASSES_DATA = parsedData.map((row, index) => ({ 
        id: row['Course Number'],
        name: row['Course Number'],
        prerequisites: (row['Prerequisites'] && row['Prerequisites'].trim().toLowerCase() !== 'none' && row['Prerequisites'].trim() !== '')
                     ? row['Prerequisites'].split(/,\s*|\/\s*/).map(p => p.trim()).filter(p => p) 
                     : [],
        description: row['Description'],
        units: parseInt(row['Units']) || 0, 
        difficulty: parseInt(row['Difficulty']) || 1, 
        category: determineCategory(row['Required or Optional']),
        taken: row['Taken'] ? row['Taken'].trim() : '', // Add taken column
        originalOrder: index 
    }));

    // Initialize fresh quarters with no pinned courses
    initializeQuarters(4);
    
    // Process courses with "Taken" assignments
    processTakenCourses();
    
    renderPlanner();
    document.body.classList.remove('loading');
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

function determineCategory(requiredOrOptional) {
    const textValue = requiredOrOptional ? requiredOrOptional.trim().toLowerCase() : "";

    if (textValue.includes('optional')) {
        return "Optional";
    }
    if (textValue.includes('capstone')) {
        return "Capstone";
    }
    if (textValue.includes('external')) { 
        return "External";
    }
    return "Required";
}

function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    errorMessage.textContent = message;
    errorMessage.style.display = 'block';
}

function initializeQuarters(numYears = 4) {
    quartersData = [];
    const quarterNames = ["Summer", "Fall", "Winter", "Spring"];
    for (let i = 0; i < numYears; i++) {
        quarterNames.forEach(qName => {
            quartersData.push({
                id: `${qName.toLowerCase()}${i + 1}`,
                name: `${qName} Year ${i + 1}`,
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
    if (quarter.name.startsWith("Fall")) seasonOrder = 1;
    else if (quarter.name.startsWith("Winter")) seasonOrder = 2;
    else if (quarter.name.startsWith("Spring")) seasonOrder = 3;
    return (quarter.year - 1) * 4 + seasonOrder;
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
            lockButton.innerHTML = isQuarterLocked(quarter.id) ? '🔒' : '🔓';
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
    
    // Add pinned class if course is pinned
    if (isPinnedCourse(classData.id)) {
        card.classList.add('pinned');
    }
    
    const prereqsText = classData.prerequisites.join(', ') || 'None';
    
    // Create structured tooltip content
    let tooltipContent = `
        <span class="course-title">${classData.description || 'No description available'}</span>
        <div class="course-prereqs">
            <span class="prereq-label">Prerequisites:</span>
            <span class="prereq-list">${prereqsText}</span>
        </div>
    `;
    
    let planningNote = "";
    if (graph[classData.id] && graph[classData.id].unassignedReason) {
        planningNote = graph[classData.id].unassignedReason;
        card.classList.add('class-card-unassigned-failed');
    } else if (classData.category === "Optional") {
        const unassignedQ = getQuarterById('unassigned');
        if (unassignedQ && unassignedQ.classes.includes(classData.id)) {
            planningNote = "Optional course, not auto-planned.";
        }
    }

    if (planningNote) {
        const noteClass = card.classList.contains('class-card-unassigned-failed') ? 'warning' : '';
        tooltipContent += `<div class="planning-note ${noteClass}">
            <strong>Planning Note:</strong> ${planningNote}
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
        <span class="units">(${classData.units} units, Diff: ${classData.difficulty})</span>
        <span class="tooltip">${tooltipContent}</span>
    `;
    
    card.appendChild(pinButton);
    return card;
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
}

function handleDragEnd(e) {
    e.target.classList.remove('dragging');
    draggedClassId = null; 
}

function handleDragOver(e) {
    e.preventDefault(); 
    const dropZone = e.target.closest('.drop-zone');
    if (dropZone) {
         dropZone.classList.add('drop-target-hover');
    }
}

function handleDragLeave(e) {
    const dropZone = e.target.closest('.drop-zone');
    if (dropZone) {
        dropZone.classList.remove('drop-target-hover');
    }
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
        if (!newQuarter.classes.includes(classId)) { 
            newQuarter.classes.push(classId);
        }
    }
    renderPlanner(); 
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
            if (!classData || classData.prerequisites.length === 0) {
                return; 
            }

            let prereqsMet = true;
            for (const prereqId of classData.prerequisites) {
                if (!completedClassesCumulative.has(prereqId)) {
                    prereqsMet = false;
                    break;
                }
            }

            const cardElement = document.getElementById(`class-${classId.replace(/\s+/g, '-')}`);
            if (cardElement && !prereqsMet) {
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
    
    // Store pinned courses before reset
    const pinnedCoursesData = new Map();
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned' && quarter.pinnedClasses.length > 0) {
            pinnedCoursesData.set(quarter.id, [...quarter.pinnedClasses]);
        }
    });
    
    // Reset all courses to unassigned
    unassignedQuarter.classes = ALL_CLASSES_DATA.map(c => c.id);
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned') {
            quarter.classes = [];
            quarter.units = 0;
            quarter.difficulty = 0;
            // Keep pinnedClasses array but clear it for now
            quarter.pinnedClasses = [];
        }
    });

    // Restore pinned courses to their quarters
    pinnedCoursesData.forEach((pinnedClassIds, quarterId) => {
        const quarter = getQuarterById(quarterId);
        if (quarter) {
            pinnedClassIds.forEach(classId => {
                // Remove from unassigned
                unassignedQuarter.classes = unassignedQuarter.classes.filter(id => id !== classId);
                // Add back to quarter
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
        .filter(q => q.id !== 'unassigned' && !q.name.toLowerCase().includes('summer'))
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
            if (canPlaceCourseInQuarterForPlanning(course, quarter)) {
                addCourseToQuarter(course, quarter, courseNode, coursesInQuarter);
                coursePlacedThisIteration = true;
                break;
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

    for (let qIdx = 0; qIdx < academicQuarters.length; qIdx++) {
        const potentialQuarter = academicQuarters[qIdx];

        if (!canPlaceCourseInQuarterForPlanning(course, potentialQuarter)) {
            continue;
        }

        const coursesCompletedBeforePotentialQuarter = new Set();
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
        
        // Check if prereq is optional AND not taken yet
        let tempCompleted = new Set();
        academicQuarters.forEach(q => q.classes.forEach(c => tempCompleted.add(c)));
        
        if (prereqCourseData && prereqCourseData.category === "Optional" && !tempCompleted.has(prereqId)) {
            prereqDetail = `Prereq. ${prereqId} (optional) not taken.`;
            break;
        }
    }
    return prereqDetail || "No suitable quarter (capacity/schedule).";
}

function fallbackCoursePlacement(graph, academicQuarters) {
    let unplacedCourseNodes = Object.values(graph).filter(node => 
        !node.placed && (node.course.category === "Required" || node.course.category === "Capstone" || node.course.category === "External")
    );
    
    let fallbackIterations = 0;
    const MAX_FALLBACK_ITERATIONS = unplacedCourseNodes.length + academicQuarters.length + 5;

    while (unplacedCourseNodes.length > 0 && fallbackIterations < MAX_FALLBACK_ITERATIONS) {
        let courseWasPlacedInFallbackPass = false;
        unplacedCourseNodes = sortUnplacedCourses(unplacedCourseNodes, graph);

        for (const courseNode of unplacedCourseNodes) {
            if (courseNode.placed) continue;

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

            if (courseData.category === "Optional") {
                return true;
            }
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

    let completedCourses = new Set();
    
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

        // Primary course placement
        primaryCoursePlacement(quarter, completedCourses, coursesAddedToThisQuarter, graph);

        // Secondary placement to meet minimum units
        secondaryCoursePlacement(quarter, completedCourses, coursesAddedToThisQuarter, graph);

        // Update completed courses (including both pinned and auto-placed)
        quarter.classes.forEach(courseId => completedCourses.add(courseId));
    }

    // Fallback placement for remaining courses
    fallbackCoursePlacement(graph, academicQuarters);

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

    // Create TSV content in the same format as input
    let tsvContent = "Taken\tCourse Number\tPrerequisites\tDescription\tUnits\tRequired or Optional\tDifficulty\n";
    
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
        
        // Escape tabs and newlines in description
        const description = (courseData.description || '').replace(/\t/g, ' ').replace(/\n/g, ' ').replace(/\r/g, ' ');
        
        // Convert category back to original format
        const requiredOrOptional = formatCategoryForExport(courseData.category);
        
        // Add row to TSV
        tsvContent += `${takenValue}\t${courseData.name}\t${prerequisites}\t${description}\t${courseData.units}\t${requiredOrOptional}\t${courseData.difficulty}\n`;
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

function formatCategoryForExport(category) {
    // Convert internal category back to original format
    switch (category) {
        case 'Required':
            return 'Required';
        case 'Optional':
            return 'Optional';
        case 'Capstone':
            return 'Capstone';
        case 'External':
            return 'External';
        default:
            return category;
    }
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
    return pinnedCourses.has(classId);
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

document.addEventListener('DOMContentLoaded', () => {
    setupDragAndDrop();
    
    if (document.getElementById('dataUrl').value) {
         loadCourseData();
    } else {
        initializeQuarters(4); 
        renderPlanner();
    }
}); 