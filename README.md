# Interactive Course Planner

Plan a college degree quarter-by-quarter with prerequisite-aware, drag-and-drop scheduling.

**Live app:** [daniellehonn.github.io/planmycourses](https://daniellehonn.github.io/planmycourses)

## What it does

Given a CSV/TSV of courses (with prerequisites, corequisites, requirement categories, and difficulty), the planner:

- Builds a prerequisite dependency graph and auto-arranges courses into quarters
- Validates every placement against prerequisites, corequisites, and unit limits
- Scores eligible courses by how many future courses they unlock (direct + indirect), how "bottleneck" they are, and their requirement weight, then auto-plans a quarter's worth of courses under a unit budget
- Lets the student drag and drop to override the plan, pin/lock courses and quarters, and see live dependency lines between prerequisite courses
- Tracks requirement-category progress and exports the finished plan

This is a **deterministic, rule-based planning engine** — there is currently no AI/LLM layer. All logic (graph construction, scoring, validation) runs client-side in the browser from an uploaded CSV; there is no backend or database.

## Quick Start

1. [Copy the course list template](https://docs.google.com/spreadsheets/d/1IkugQtWd_GgqWf7J7NXUQ3XwH0jD0YoG5QRHAMxUFn4/edit?usp=sharing) (File → Make a copy)
2. Replace the sample rows with your own courses, ordered by priority
3. Publish the sheet to the web as **TSV** (File → Share → Publish to web → Tab-separated values), and confirm the link ends in `output=tsv`
4. Paste the link into the planner (or upload a CSV directly) and click auto-plan
5. Drag courses between quarters to adjust; pin/lock anything that shouldn't move
6. Export the finished plan

### Course data format

Each row needs:

| Column | Meaning |
|---|---|
| `Taken` | Quarter status, e.g. `Fall, Year 1` or `Not Assigned` |
| `Req Satisfied` | Requirement category (`Lower Div`, `Major Core`, `5 Elective`, `GE`, etc.) |
| `Course Number` | Course ID, e.g. `CS 35L` |
| `Prerequisites` | Comma-separated list, or `None`. Must match another row's Course Number exactly. |
| `Corequisites` | Comma-separated list, or `None`. Placed in the same quarter automatically. |
| `Description` | Course title/description |
| `Difficulty` | 1–8 scale |

Prerequisite/corequisite lists are treated as `AND` — a course becomes eligible only once every listed course is completed or (for corequisites) scheduled in the same quarter.

## How the scheduler decides what to take next

The planner is a **priority-based topological scheduler**, not a simple sort by course number or difficulty:

1. Model courses as nodes in a directed graph; prerequisites are edges (prereq → dependent).
2. Each quarter, find courses the student is eligible for (not completed, prereqs satisfied, coreqs satisfiable, offered that term if known).
3. Score every eligible course:

   ```
   priority_score =
       10 × required_direct_unlocks
     +  6 × required_indirect_unlocks
     +  5 × elective_direct_unlocks
     +  3 × elective_indirect_unlocks
     +  8 × longest_chain_length
     +  requirement_weight
     +  offering_urgency_bonus
     +  manual_priority_override
     -  difficulty_penalty (difficulty × 2)
   ```

4. Requirement weights default to: Major Core (40) > Capstone (35) > Lower Div (30) > minor-pathway tiers (28/24/20) > 5 Elective (18) > TB (12) > GE (8) > Grad Level (5). These are user-adjustable via a drag-to-reorder priority list in Settings.
5. Generate combinations of eligible courses (not just the top N) and pick the best-scoring combination that fits the unit budget (default max 18 / min 12 units).

**Bottleneck courses** — ones that unlock many future required courses (e.g. `CS 35L` → `CS 111`/`CS 131` → `CS 130`) — are prioritized over courses that are merely required but low-impact.

## Current implementation status

This section tracks the project against the four-version roadmap outlined by the project mentor (see the `Course Planner` project in et-al for the full objective/task breakdown).

| Version | Scope | Status |
|---|---|---|
| **V1 — Reliable planning engine** | Prerequisite/corequisite/unit validation, dependency graph, requirement tracking | Mostly built. Missing: richer per-course schema (`offered_terms`, `workload_type`, explicit `unlocks`), duplicate-requirement detection, graduation-date feasibility checks |
| **V2 — Personalized optimization** | Weighted scoring, combinatorial quarter selection | Mostly built. Missing: multiple named plan variants (fastest / balanced / interest-focused / flexible-with-backups), interest-alignment and graduation-speed scoring terms, alternative-plan comparison UI |
| **V3 — AI copilot** | Natural-language constraint parsing, planning chat | Not started |
| **V4 — Recovery agent** | Handle unavailable courses, propose alternatives with trade-off explanations | Not started |
| **Backend & database** | FastAPI services, Postgres persistence, plan versioning | Not started — currently a static, client-side-only app |
| **Evaluation plan** | Benchmark suite, metrics, user study | Not started |

## Architecture (current)

Pure static frontend — `index.html`, `styles.css`, `script.js`. No server, no database. Course data is loaded from a pasted TSV link or uploaded CSV and held entirely in browser memory/localStorage; there is no persistence of plan versions or user accounts across sessions.

### Target architecture (per roadmap)

```
Student Request
      ↓
AI Intent Parser        (not built)
      ↓
Structured Constraints  (not built)
      ↓
Deterministic Planning Engine   (built, client-side — needs backend migration)
      ↓
Validation Engine       (built, client-side)
      ↓
Plan Explanation        (partial — only rejection reasons exist)
      ↓
User Approval           (built, via drag-and-drop review)
```

Planned backend services: Course Catalog Service, Degree Requirement Service, Planning Engine, Validation Engine, Recommendation Service, AI Intent Parser, Plan Explanation Service, User Feedback Service — backed by Postgres (courses, prerequisites, requirements, course_offerings, user_courses, user_preferences, degree_plans, plan_versions, feedback).

## Files

- `index.html` / `styles.css` / `script.js` — the app
- `course_scheduler_algorithm_spec.md` — detailed algorithm spec (priority scoring, workload balancing, edge cases)
- `instructions.md` — end-user setup instructions for the Google Sheets template
- `DANIELLEHON-FINAL_*.csv` — sample course list

## Roadmap

See the `Course Planner` project workspace in et-al for the live objective/task breakdown (V1 gap-closing, V2 multi-plan generation, V3 AI copilot, V4 recovery agent, backend/DB migration, and the evaluation plan).
