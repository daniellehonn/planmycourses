# Course Scheduler / Planner Algorithm Specification

## Goal

Build a system that recommends which courses a student should take each quarter by using prerequisite structure, requirement progress, course difficulty, and scheduling constraints.

The core idea is a **priority-based topological scheduler**:

1. Model courses as nodes in a directed graph.
2. Model prerequisites as edges from prerequisite course → dependent course.
3. Each quarter, find courses the student is eligible to take.
4. Score eligible courses by how much they unlock, how important they are, and how urgent they are.
5. Select the best combination of courses that fits workload and unit limits.

This system should not simply sort by difficulty or by course number. It should prioritize **bottleneck courses**: courses that block many future required courses.

---

## Input Data

The current CSV planner has these columns:

| Column | Meaning |
|---|---|
| `Taken` | Quarter status, such as `Fall, Year 1`, `Summer, Year 2`, or `Not Assigned` |
| `Req Satisfied` | Requirement category, such as `Lower Div`, `Major Core`, `5 Elective`, `GE`, etc. |
| `Course Number` | Course ID, such as `CS 35L`, `CS M51A`, `STATS 100A` |
| `Prerequisites` | Comma-separated prerequisite list |
| `Corequisites` | Courses that must be taken before or at the same time |
| `Description` | Course title or description |
| `Difficulty` | Estimated difficulty score |

Recommended additional fields for a production system:

| Field | Type | Purpose |
|---|---:|---|
| `units` | number | Used to enforce max units per quarter |
| `offered_terms` | string array | Example: `["Fall", "Winter", "Spring"]` |
| `is_required` | boolean | Whether course is required for the degree/minor |
| `requirement_group` | string | Example: `Major Core`, `Lower Div`, `Stats Minor`, `GE` |
| `min_grade_required` | string/null | Optional enforcement of prerequisite grade rules |
| `repeatable` | boolean | For special topics courses |
| `priority_override` | number/null | Manual advisor override when needed |
| `notes` | string/null | Human-readable warnings or context |

---

## Data Model

A course can be represented as:

```ts
type Course = {
  id: string;                         // "CS 35L"
  title?: string;                     // "Software Construction"
  taken: string;                      // "Not Assigned" or "Fall, Year 1"
  requirement: string;                // "Major Core", "Lower Div", etc.
  prerequisites: PrerequisiteExpr;    // parsed prerequisite expression
  corequisites: PrerequisiteExpr;
  difficulty: number;                 // 1-5 scale in current planner
  units?: number;
  offeredTerms?: Term[];              // ["Fall", "Winter", "Spring"]
  completed?: boolean;
  plannedQuarter?: Quarter | null;
};

type Term = "Fall" | "Winter" | "Spring" | "Summer";

type Quarter = {
  term: Term;
  year: number;
};
```

### Prerequisite Expression

The current planner uses comma-separated prerequisites, which should be treated as `AND` unless the data explicitly says otherwise.

Example:

```text
CS 111 prerequisites: CS 32, CS 33, CS 35L
```

Means:

```text
CS 32 AND CS 33 AND CS 35L
```

For future flexibility, support both `AND` and `OR` prerequisite logic:

```ts
type PrerequisiteExpr =
  | { type: "course"; courseId: string }
  | { type: "and"; children: PrerequisiteExpr[] }
  | { type: "or"; children: PrerequisiteExpr[] }
  | { type: "none" };
```

Example:

```ts
{
  type: "and",
  children: [
    { type: "course", courseId: "CS 32" },
    { type: "course", courseId: "CS 33" },
    { type: "course", courseId: "CS 35L" }
  ]
}
```

---

## Graph Model

Create a directed graph:

```text
prerequisite course → course that depends on it
```

Example:

```text
CS 32 → CS 35L
CS 35L → CS 111
CS 35L → CS 131
CS 111 → CS 118
CS 111 → CS 130
CS 131 → CS 130
```

This graph lets the system calculate:

1. Direct unlocks
2. Indirect unlocks
3. Longest prerequisite chain
4. Bottleneck value
5. Delaying penalty

---

## Key Concepts

### 1. Eligible Course

A course is eligible in a quarter if:

1. It is not already completed.
2. It is not already planned in an earlier quarter.
3. All prerequisites are completed before the quarter starts.
4. All corequisites are either completed or scheduled in the same quarter.
5. The course is offered in that term, if offering data is available.

```ts
function isEligible(course: Course, completed: Set<string>, quarter: Quarter): boolean {
  if (completed.has(course.id)) return false;
  if (!isOffered(course, quarter.term)) return false;
  return prereqSatisfied(course.prerequisites, completed);
}
```

### 2. Direct Unlocks

Direct unlocks are courses that list the current course as an immediate prerequisite.

Example:

```text
CS M51A directly unlocks:
- CS M151B
- CS M152A
```

### 3. Indirect Unlocks

Indirect unlocks are courses further down the graph.

Example:

```text
CS 35L → CS 111 → CS 130
CS 35L → CS 131 → CS 130
```

So CS 35L indirectly helps unlock CS 130.

### 4. Bottleneck Course

A bottleneck course is a course that blocks many future courses, especially required courses.

Examples from this planner:

| Course | Why it is a bottleneck |
|---|---|
| `CS 35L` | Unlocks `CS 111`, `CS 131`, and eventually `CS 130` |
| `CS M51A` | Unlocks `CS M151B` and `CS M152A` |
| `STATS 100A` | Unlocks `CS M146`, `CS M148`, and data/stat pathway courses |
| `CS 180` | Unlocks `CS 181`, `CS 161`, `CS 260` |

A course like `MATH 33B` may still be required, but if nothing depends on it, it has low unlock value.

---

## Priority Score

Each eligible course should receive a priority score.

Recommended formula:

```text
priority_score =
    10 × required_direct_unlocks
  +  6 × required_indirect_unlocks
  +  5 × elective_direct_unlocks
  +  3 × elective_indirect_unlocks
  +  8 × longest_chain_length
  +  requirement_weight
  +  offering_urgency_bonus
  +  manual_priority_override
  -  difficulty_penalty
```

### Suggested Weights

| Factor | Suggested weight | Reason |
|---|---:|---|
| Required direct unlock | `10` | Most important. A course that unlocks required courses should be taken early. |
| Required indirect unlock | `6` | Still important, but less urgent than direct unlocks. |
| Elective direct unlock | `5` | Useful because it opens options. |
| Elective indirect unlock | `3` | Useful but lower priority. |
| Longest chain length | `8` | Long chains need to start early. |
| Requirement weight | varies | Major Core > Lower Div > Elective > GE. |
| Offering urgency | varies | Fall-only or infrequently offered courses should be prioritized. |
| Difficulty penalty | small | Difficulty should balance workload, not dominate priority. |

### Requirement Weights

```ts
const REQUIREMENT_WEIGHTS = {
  "Major Core": 40,
  "Capstone": 35,
  "Lower Div": 30,
  "Probability, Stats & DS Minor": 28,
  "ST, Stats & DS Minor": 24,
  "Stats & DS Minor": 20,
  "5 Elective": 18,
  "TB": 12,
  "GE": 8,
  "Grad Level": 5
};
```

These values can be tuned.

### Difficulty Penalty

Do not punish hard courses too much. A difficult bottleneck course may still need to be taken early.

Recommended:

```text
difficulty_penalty = difficulty × 2
```

Example: a difficulty 5 course gets a `-10` penalty, not enough to bury an important requirement.

---

## Workload Balancing

After scoring courses, the system should not automatically choose the top 3 or 4 courses. It should choose the best valid combination under workload constraints.

Recommended constraints:

```ts
type QuarterConstraints = {
  maxUnits: number;
  minUnits: number;
  maxDifficulty: number;
  maxTechnicalCourses: number;
  maxMajorCoreCourses: number;
};
```

Suggested defaults:

```ts
const DEFAULT_CONSTRAINTS = {
  maxUnits: 18,
  minUnits: 12,
  maxDifficulty: 13,
  maxTechnicalCourses: 3,
  maxMajorCoreCourses: 2
};
```

Difficulty guidance:

| Total difficulty | Interpretation |
|---:|---|
| `8-10` | Light/medium quarter |
| `11-13` | Normal technical quarter |
| `14-15` | Heavy quarter |
| `16+` | Usually avoid unless student explicitly wants overload |

Example:

```text
CS 35L = 4
CS M51A = 4
STATS 100A = 4
Total difficulty = 12
```

This is a strong but reasonable technical quarter.

But:

```text
CS 35L = 4
CS M51A = 4
STATS 100A = 4
PHYSICS 1B = 5
Total difficulty = 17
```

This should usually be rejected as too heavy.

---

## Course Selection Algorithm

For each quarter:

1. Find all courses not completed or already planned.
2. Filter to courses offered that quarter.
3. Filter to courses whose prerequisites are satisfied.
4. Score each eligible course.
5. Generate possible course combinations.
6. Remove combinations that violate workload/unit constraints.
7. Choose the combination with the highest total score.
8. Mark selected courses as planned/completed for future-quarter simulation.

---

## Pseudocode

```ts
function buildSchedule(
  courses: Course[],
  startingCompleted: Set<string>,
  quarters: Quarter[],
  constraints: QuarterConstraints
): Map<Quarter, Course[]> {
  const graph = buildPrerequisiteGraph(courses);
  const schedule = new Map<Quarter, Course[]>();
  const completed = new Set(startingCompleted);

  for (const quarter of quarters) {
    const eligible = courses.filter(course =>
      !completed.has(course.id) &&
      isOffered(course, quarter.term) &&
      prereqSatisfied(course.prerequisites, completed)
    );

    const scored = eligible.map(course => ({
      course,
      score: computePriorityScore(course, graph, courses)
    }));

    const candidateSchedules = generateCourseCombinations(scored);

    const validSchedules = candidateSchedules.filter(combo =>
      satisfiesConstraints(combo.map(x => x.course), constraints)
    );

    const bestSchedule = maxBy(validSchedules, combo =>
      combo.reduce((sum, item) => sum + item.score, 0)
    );

    const selectedCourses = bestSchedule.map(item => item.course);
    schedule.set(quarter, selectedCourses);

    for (const course of selectedCourses) {
      completed.add(course.id);
    }
  }

  return schedule;
}
```

---

## Priority Score Pseudocode

```ts
function computePriorityScore(course: Course, graph: Graph, allCourses: Course[]): number {
  const directUnlocks = getDirectUnlocks(course.id, graph);
  const indirectUnlocks = getIndirectUnlocks(course.id, graph);

  const requiredDirectUnlocks = countRequired(directUnlocks, allCourses);
  const requiredIndirectUnlocks = countRequired(indirectUnlocks, allCourses);
  const electiveDirectUnlocks = countElective(directUnlocks, allCourses);
  const electiveIndirectUnlocks = countElective(indirectUnlocks, allCourses);

  const longestChainLength = getLongestChainLength(course.id, graph);
  const requirementWeight = getRequirementWeight(course.requirement);
  const offeringUrgencyBonus = getOfferingUrgencyBonus(course);
  const manualOverride = course.priorityOverride ?? 0;
  const difficultyPenalty = course.difficulty * 2;

  return (
    10 * requiredDirectUnlocks +
     6 * requiredIndirectUnlocks +
     5 * electiveDirectUnlocks +
     3 * electiveIndirectUnlocks +
     8 * longestChainLength +
     requirementWeight +
     offeringUrgencyBonus +
     manualOverride -
     difficultyPenalty
  );
}
```

---

## Combination Selection

Do not greedily pick the top N courses without checking combinations.

A greedy approach can accidentally choose:

```text
CS 111 + CS 131 + PHYSICS 1B
```

when a more balanced schedule would be better:

```text
CS 111 + MATH 33B + GE
```

Use a small combinatorial search because the number of eligible courses per quarter is usually small.

```ts
function generateCourseCombinations(scoredCourses: ScoredCourse[]): ScoredCourse[][] {
  const combinations: ScoredCourse[][] = [];

  // Generate subsets of size 2-5 or until max unit limit is impossible.
  for (let size = 2; size <= 5; size++) {
    combinations.push(...combinationsOf(scoredCourses, size));
  }

  return combinations;
}
```

Then rank each schedule combination by:

```text
combination_score =
    sum(course priority scores)
  + balance_bonus
  - overload_penalty
```

### Balance Bonus

Reward schedules that mix technical and lighter courses.

```text
+10 if schedule includes 2 technical + 1 lighter requirement
+5 if schedule includes a GE/TB with two hard technical courses
-20 if schedule includes 4 hard technical courses
```

---

## Handling Corequisites

A corequisite can be satisfied if:

1. The corequisite is already completed, or
2. The corequisite is selected in the same quarter.

So corequisite validation must happen at the combination level, not only the individual-course level.

```ts
function coreqsSatisfied(course: Course, completed: Set<string>, selectedThisQuarter: Set<string>): boolean {
  return prereqSatisfied(course.corequisites, union(completed, selectedThisQuarter));
}
```

---

## Handling Multiple Requirement Paths

Some courses satisfy multiple requirements, such as:

```text
STATS 100A → Probability requirement + Stats & DS minor
```

The algorithm should give extra value to courses that satisfy multiple outstanding requirements.

Recommended:

```text
multi_requirement_bonus = 10 × number_of_outstanding_requirements_satisfied
```

Example:

```text
STATS 100A satisfies:
- CS probability/stat requirement
- Stats & DS minor pathway
- Prerequisite for ML/Data Science electives
```

Therefore it should rank above a course that satisfies only one isolated requirement.

---

## Handling Course Offerings

If offering data is available, apply an urgency bonus.

```ts
function getOfferingUrgencyBonus(course: Course): number {
  const terms = course.offeredTerms ?? [];

  if (terms.length === 0) return 0;       // unknown offering data
  if (terms.length === 1) return 30;      // offered once per year
  if (terms.length === 2) return 15;      // offered twice per year
  if (terms.length >= 3) return 5;        // commonly offered

  return 0;
}
```

A course offered only in Fall should be prioritized in Fall if the student is eligible.

---

## Handling Already Completed Courses

A course is completed if `Taken` is not `Not Assigned`.

For example, in the current planner:

```text
Completed/planned before Fall Year 2:
- CS 1
- CS 31
- CS 32
- CS 33
- MATH 32A
- MATH 32B
- MATH 33A
- MATH 61
- PHYSICS 1A
- CS 180
- MGMT 170
- several GEs
```

The system should treat those courses as already available for prerequisite purposes.

---

## Example: Fall Year 2 Ranking

Given the current planner, likely eligible Fall Year 2 courses include:

```text
CS 35L
CS M51A
STATS 100A
MATH 33B
PHYSICS 1B
GE / TB courses
```

Expected priority ranking:

| Rank | Course | Reason |
|---:|---|---|
| 1 | `CS 35L` | Unlocks `CS 111`, `CS 131`, and eventually `CS 130` |
| 2 | `CS M51A` | Unlocks `CS M151B` and `CS M152A` |
| 3 | `STATS 100A` | Unlocks ML/data science courses and satisfies probability/stat needs |
| 4 | `PHYSICS 1B` | Required lower-div sequence course, but high difficulty |
| 5 | `MATH 33B` | Required, but low direct unlock value in this planner |
| 6 | `GE/TB` | Useful as workload filler, but less urgent |

Recommended output:

```text
Fall Year 2:
- CS 35L
- CS M51A
- STATS 100A
```

Reason:

```text
This clears the biggest bottlenecks while keeping total difficulty around 12.
```

---

## Output Format

The system should produce a schedule plus explanations.

Example:

```json
{
  "quarter": "Fall Year 2",
  "recommended_courses": [
    {
      "course": "CS 35L",
      "reason": "Unlocks CS 111, CS 131, and eventually CS 130.",
      "difficulty": 4,
      "priority_score": 128
    },
    {
      "course": "CS M51A",
      "reason": "Unlocks required architecture/digital design courses CS M151B and CS M152A.",
      "difficulty": 4,
      "priority_score": 104
    },
    {
      "course": "STATS 100A",
      "reason": "Satisfies probability/stat requirement and unlocks ML/data science courses.",
      "difficulty": 4,
      "priority_score": 93
    }
  ],
  "total_difficulty": 12,
  "warning": null,
  "backup_options": [
    "MATH 33B",
    "PHYSICS 1B",
    "GE"
  ]
}
```

---

## Explanation Generator

The UI should not only output courses. It should explain why each course was chosen.

For each recommended course, generate explanations using these templates:

### Bottleneck explanation

```text
Take {course_id} now because it unlocks {direct_unlocks}. Delaying it may delay {indirect_unlocks} later.
```

### Requirement explanation

```text
This course satisfies {requirement_group}, which is still outstanding in your plan.
```

### Workload explanation

```text
This schedule has total difficulty {difficulty_total}, which is within your target range of {max_difficulty}.
```

### Backup explanation

```text
If {course_id} is unavailable, the next best substitute is {backup_course_id} because {reason}.
```

---

## Important Edge Cases

### 1. Circular prerequisites

The graph should be checked for cycles. A valid course catalog should not have cycles in prerequisite chains.

```ts
if (hasCycle(graph)) {
  throw new Error("Invalid prerequisite graph: cycle detected.");
}
```

### 2. Missing prerequisite course

If a prerequisite appears in text but is not listed as a course node, store it as an external prerequisite.

Example:

```text
Prerequisite: ECE M16
```

If `ECE M16` is not in the planner, mark it as external and do not crash.

### 3. Unknown offering data

If offering data is missing, do not block the course. Instead, assume it may be available and add a warning:

```text
Offering data unavailable. Verify before enrollment.
```

### 4. Alternatives / equivalent courses

Support equivalent courses.

Example:

```text
CS M51A may be equivalent to ECE M16.
```

Data structure:

```ts
type CourseEquivalence = {
  groupId: string;
  courseIds: string[];
};
```

If one course in an equivalence group is completed, treat the requirement as satisfied.

### 5. Student preference overrides

Allow user preferences such as:

```json
{
  "prefer_lighter_quarters": true,
  "target_track": "AI/Data Science",
  "avoid_summer": false,
  "max_technical_courses": 3
}
```

These preferences should affect scores, not hard-code the schedule unless required.

---

## Recommended MVP Implementation Plan

### Phase 1: Basic Scheduler

Implement:

- CSV parser
- Course data model
- Prerequisite parser for comma-separated `AND` prerequisites
- Completed-course detection
- Direct unlock counting
- Eligibility filtering
- Priority scoring
- Quarter recommendation output

### Phase 2: Better Graph Intelligence

Add:

- Indirect unlock counting
- Longest chain length
- Bottleneck detection
- Combination-based schedule selection
- Workload balancing

### Phase 3: Production Features

Add:

- Course offering data
- Equivalent courses
- OR prerequisites
- Corequisite validation
- Requirement audit
- User preference settings
- Natural-language explanations

---

## Minimal MVP Algorithm

A simple version can be implemented with this logic:

```ts
for each uncompleted course:
  if prerequisites are completed:
    direct_unlock_count = number of courses that require this course
    required_unlock_count = number of required courses that require this course
    score =
      10 * required_unlock_count +
       5 * direct_unlock_count +
       requirement_weight -
       2 * difficulty

sort eligible courses by score descending
choose top courses that fit max difficulty
```

This MVP will already produce reasonable recommendations like:

```text
CS 35L > CS M51A > STATS 100A > MATH 33B
```

---

## Main Principle

The scheduler should always ask:

```text
What happens if the student delays this course?
```

Courses should be prioritized when delaying them would block future required courses, long prerequisite chains, or limited-offering opportunities.

A good scheduling algorithm prioritizes:

```text
bottlenecks > required chains > limited offerings > multi-requirement courses > flexible filler courses
```
