let ALL_CLASSES_DATA = [];
let quartersData = [];
let draggedClassId = null;
let graph = {};

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

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch data (status: ${response.status})`);
        }

        const tsvData = await response.text();
        const parsedData = parseTSV(tsvData);
        
        if (parsedData.length === 0) {
            throw new Error('No data found in TSV');
        }

        ALL_CLASSES_DATA = parsedData.map((row, index) => ({ 
            id: row['Class Symbol'],
            name: row['Class Symbol'],
            prerequisites: (row['Prerequisites'] && row['Prerequisites'].trim().toLowerCase() !== 'none' && row['Prerequisites'].trim() !== '')
                         ? row['Prerequisites'].split(/,\s*|\/\s*/).map(p => p.trim()).filter(p => p) 
                         : [],
            description: row['Description'],
            units: parseInt(row['Units']) || 0, 
            difficulty: parseInt(row['Difficulty']) || 1, 
            category: determineCategory(row['Required or Optional']),
            originalOrder: index 
        }));

        initializeQuarters(4);
        renderPlanner();
        document.body.classList.remove('loading');
    } catch (error) {
        console.error("Error in loadCourseData:", error);
        showError("Error loading data: " + error.message);
        document.body.classList.remove('loading');
    }
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

            const headerDiv = document.createElement('div');
            headerDiv.className = 'quarter-header';
            headerDiv.innerHTML = `<span>${quarter.name.replace(` Year ${i}`, '')}</span> 
                                 <span class="quarter-units" id="units-${quarter.id}">${quarter.units} units</span>
                                 <span class="quarter-units" id="difficulty-${quarter.id}">${quarter.difficulty} difficulty</span>`;
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
    
    const prereqsText = classData.prerequisites.join(', ') || 'None';
    let tooltipContent = `<strong>${classData.description || 'No description.'}</strong><br><strong>Prereqs:</strong> ${prereqsText}`;
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
         tooltipContent += `<br><strong style="color: ${card.classList.contains('class-card-unassigned-failed') ? '#ffdddd' : '#ddddff'};">Planning Note:</strong> ${planningNote}`;
    }

    card.innerHTML = `
        ${classData.name}
        <span class="units">(${classData.units} units, Diff: ${classData.difficulty})</span>
        <span class="tooltip">${tooltipContent}</span>
    `;
    return card;
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

function autoPlanCoreCourses() {
    const unassignedQuarter = getQuarterById('unassigned');
    if (!unassignedQuarter) {
        console.error("Unassigned quarter not found.");
        return;
    }
    
    unassignedQuarter.classes = ALL_CLASSES_DATA.map(c => c.id); 
    quartersData.forEach(quarter => {
        if (quarter.id !== 'unassigned') {
            quarter.classes = [];
            quarter.units = 0;
            quarter.difficulty = 0;
        }
    });
    graph = {}; 

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

    Object.values(graph).forEach(node => {
        node.prerequisites.forEach(prereqId => {
            if (graph[prereqId]) {
                graph[prereqId].dependents.push(node.course.id);
            }
        });
    });

    const academicQuarters = quartersData
        .filter(q => q.id !== 'unassigned' && !q.name.toLowerCase().includes('summer'))
        .sort((a, b) => getQuarterChronologicalOrder(a) - getQuarterChronologicalOrder(b));

    const MAX_UNITS_PER_QUARTER = 15; 
    const MIN_UNITS_PER_QUARTER = 12; 
    const TARGET_UNITS_PER_QUARTER = 13; 
    const MAX_DIFFICULTY_PER_QUARTER = 15; 
    const TARGET_DIFFICULTY_PER_QUARTER = 12; 

    let completedCourses = new Set(); 
    for (const quarter of academicQuarters) {
        let coursesAddedToThisQuarterInThisPass = new Set(); 

        // Primary filling loop
        while (true) { 
            const availableCourseNodes = getAvailableCoursesForPlanning(
                completedCourses,
                coursesAddedToThisQuarterInThisPass,
                graph 
            );

            if (availableCourseNodes.length === 0) break; 

            let coursePlacedThisIteration = false;
            for (const courseNode of availableCourseNodes) {
                const course = courseNode.course;
                if (
                    quarter.units + course.units <= MAX_UNITS_PER_QUARTER &&
                    quarter.difficulty + (course.difficulty || 1) <= MAX_DIFFICULTY_PER_QUARTER
                ) {
                    quarter.classes.push(course.id);
                    courseNode.placed = true;
                    coursesAddedToThisQuarterInThisPass.add(course.id);
                    quarter.units += course.units;
                    quarter.difficulty += (course.difficulty || 1);
                    coursePlacedThisIteration = true;
                    break; 
                }
            }
            if (!coursePlacedThisIteration) break; 
        }

        // Secondary pass to meet MIN_UNITS_PER_QUARTER
        if (quarter.units < MIN_UNITS_PER_QUARTER) {
            let attemptsToMeetMinUnits = 0;
            const MAX_ATTEMPTS_MIN_UNITS = 5; // Try adding up to 5 more courses

            while (quarter.units < MIN_UNITS_PER_QUARTER && attemptsToMeetMinUnits < MAX_ATTEMPTS_MIN_UNITS) {
                const availableForMinFill = getAvailableCoursesForPlanning(
                    completedCourses, 
                    coursesAddedToThisQuarterInThisPass, 
                    graph
                );

                if (availableForMinFill.length === 0) break;
                
                let courseAddedToMeetMin = false;
                for (const courseNode of availableForMinFill) {
                    const course = courseNode.course;
                    if (
                        quarter.units + course.units <= MAX_UNITS_PER_QUARTER &&
                        quarter.difficulty + (course.difficulty || 1) <= MAX_DIFFICULTY_PER_QUARTER &&
                        !coursesAddedToThisQuarterInThisPass.has(course.id) 
                    ) {
                        quarter.classes.push(course.id);
                        courseNode.placed = true;
                        coursesAddedToThisQuarterInThisPass.add(course.id);
                        quarter.units += course.units;
                        quarter.difficulty += (course.difficulty || 1);
                        courseAddedToMeetMin = true;
                        break; 
                    }
                }
                if (!courseAddedToMeetMin) break; 
                attemptsToMeetMinUnits++;
            }
        }
        // Update completed courses based on ALL courses finally placed in this quarter
        quarter.classes.forEach(courseId => completedCourses.add(courseId));
    }

    // --- Fallback Placement Loop ---
    let unplacedCourseNodes = Object.values(graph).filter(node => !node.placed && (node.course.category === "Required" || node.course.category === "Capstone" || node.course.category === "External"));
    let fallbackIterations = 0;
    const MAX_FALLBACK_ITERATIONS = unplacedCourseNodes.length + academicQuarters.length + 5; 

    while (unplacedCourseNodes.length > 0 && fallbackIterations < MAX_FALLBACK_ITERATIONS) {
        let courseWasPlacedInFallbackPass = false;
        unplacedCourseNodes.sort((a, b) => {
            if (a.originalOrder !== b.originalOrder) return a.originalOrder - b.originalOrder;
            const aPrereqsUnmet = a.prerequisites.filter(pId => graph[pId] && !graph[pId].placed).length;
            const bPrereqsUnmet = b.prerequisites.filter(pId => graph[pId] && !graph[pId].placed).length;
            if (aPrereqsUnmet !== bPrereqsUnmet) return aPrereqsUnmet - bPrereqsUnmet;
            return (a.course.difficulty || 1) - (b.course.difficulty || 1);
        });

        for (const courseNode of unplacedCourseNodes) {
            if (courseNode.placed) continue;

            const course = courseNode.course;
            let bestQuarterToPlaceIn = null;
            let bestScore = -Infinity;

            for (let qIdx = 0; qIdx < academicQuarters.length; qIdx++) {
                const potentialQuarter = academicQuarters[qIdx];

                if (potentialQuarter.units + course.units > MAX_UNITS_PER_QUARTER ||
                    potentialQuarter.difficulty + (course.difficulty || 1) > MAX_DIFFICULTY_PER_QUARTER) {
                    continue; 
                }

                const coursesCompletedBeforePotentialQuarter = new Set();
                for (let prevQIdx = 0; prevQIdx < qIdx; prevQIdx++) {
                    academicQuarters[prevQIdx].classes.forEach(cId => coursesCompletedBeforePotentialQuarter.add(cId));
                }
                if (!courseNode.prerequisites.every(prereqId => coursesCompletedBeforePotentialQuarter.has(prereqId) || !graph[prereqId] )) {
                    continue; 
                }

                let currentScore = 0;
                const newQuarterUnits = potentialQuarter.units + course.units;
                const newQuarterDifficulty = potentialQuarter.difficulty + (course.difficulty || 1);

                if (potentialQuarter.units < MIN_UNITS_PER_QUARTER) {
                    currentScore += 300; 
                    if (newQuarterUnits >= MIN_UNITS_PER_QUARTER) currentScore += 150; 
                } else if (newQuarterUnits > MAX_UNITS_PER_QUARTER) { 
                    currentScore -= 1000; 
                }
                
                if (newQuarterDifficulty <= TARGET_DIFFICULTY_PER_QUARTER) currentScore += 100;
                else currentScore -= (newQuarterDifficulty - TARGET_DIFFICULTY_PER_QUARTER) * 30; // Increased penalty

                if (newQuarterDifficulty < MAX_DIFFICULTY_PER_QUARTER - 3) currentScore += 20; // Bonus for staying well below max diff
                
                currentScore -= Math.abs(newQuarterUnits - TARGET_UNITS_PER_QUARTER) * 10;
                currentScore -= qIdx * 15; 

                if (currentScore > bestScore) {
                    bestScore = currentScore;
                    bestQuarterToPlaceIn = potentialQuarter;
                }
            }

            if (bestQuarterToPlaceIn) {
                bestQuarterToPlaceIn.classes.push(course.id);
                courseNode.placed = true;
                bestQuarterToPlaceIn.units += course.units;
                bestQuarterToPlaceIn.difficulty += (course.difficulty || 1);
                courseWasPlacedInFallbackPass = true;
                break; 
            }
        }
        
        unplacedCourseNodes = Object.values(graph).filter(node => !node.placed && (node.course.category === "Required" || node.course.category === "Capstone" || node.course.category === "External"));
        if (!courseWasPlacedInFallbackPass && unplacedCourseNodes.length > 0) {
            unplacedCourseNodes.forEach(node => {
                if (!node.unassignedReason) {
                     let prereqDetail = "";
                     for (const prereqId of node.prerequisites) {
                         if (graph[prereqId] && !graph[prereqId].placed) {
                             prereqDetail = `Prereq. ${prereqId} not scheduled.`; break;
                         }
                         const prereqCourseData = findClassById(prereqId);
                         if(!prereqCourseData && !graph[prereqId]){ 
                             prereqDetail = `Prereq. ${prereqId} missing from data.`; break;
                         }
                         // Check if prereq is optional AND actually not taken yet (even if it's an optional course, if it was planned, it's met)
                         let tempCompleted = new Set();
                         academicQuarters.forEach(q => q.classes.forEach(c => tempCompleted.add(c)));

                         if(prereqCourseData && prereqCourseData.category === "Optional" && !tempCompleted.has(prereqId)){
                             prereqDetail = `Prereq. ${prereqId} (optional) not taken.`; break;
                         }
                     }
                     node.unassignedReason = prereqDetail || "No suitable quarter (capacity/schedule).";
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
    
    unassignedQuarter.classes = ALL_CLASSES_DATA
        .map(c => c.id)
        .filter(id => {
            const courseData = findClassById(id);
            if (!courseData) return false; 

            if (courseData.category === "Optional") { 
                return true;
            }
            if (graph[id]) { // Core course, check if placed
                return !graph[id].placed;
            }
            // If it's a core category but somehow not in graph (should not happen), treat as unassigned.
            return (courseData.category === "Required" || courseData.category === "Capstone" || courseData.category === "External");
        });

    renderPlanner();
}

function toggleInstructions() {
    const content = document.getElementById('instructionsContent');
    const toggle = document.getElementById('instructionsToggle');
    
    if (content.classList.contains('expanded')) {
        content.classList.remove('expanded');
        toggle.classList.remove('rotated');
    } else {
        content.classList.add('expanded');
        toggle.classList.add('rotated');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    if (document.getElementById('dataUrl').value) {
         loadCourseData();
    } else {
        initializeQuarters(4); 
        renderPlanner();
    }
}); 