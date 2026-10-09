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

This is a **deterministic, rule-based planning engine** — there is currently no AI/LLM layer. All planning logic (graph construction, scoring, validation) runs client-side in the browser. Plans auto-save to the browser, and an optional Supabase account syncs your course list, plan, and settings across devices.

## Quick Start

1. [Copy the course list template](https://docs.google.com/spreadsheets/d/1IkugQtWd_GgqWf7J7NXUQ3XwH0jD0YoG5QRHAMxUFn4/edit?usp=sharing) (File → Make a copy)
2. Replace the sample rows with your own courses, ordered by priority
3. Download it as CSV and click **Upload CSV**, or publish it to the web (File → Share → Publish to web → Comma-separated values) and paste the link
4. Pick quarters or semesters, how long you have to graduate, and (optionally) max units per term, then click **Auto Plan Courses**
5. Drag courses to adjust, or click a course to see its details and move it from there (this also works on phones). Pin courses or lock terms that shouldn't move
6. Export the finished plan

### Course data format

Each row needs:

| Column | Meaning |
|---|---|
| `Taken` | The term you took the course, e.g. `Fall, Year 1`, or `Not Assigned`. The course is pinned there and **the term is locked**, so Auto Plan treats it as done and adds nothing to it. Unlock the term to plan into it. |
| `Req Satisfied` | Requirement category (`Lower Div`, `Major Core`, `5 Elective`, `GE`, etc.). Separate several with commas — `ST, Stats & DS Minor` counts toward both `ST` and `Stats & DS Minor`. |
| `Course Number` | Course ID, e.g. `CS 35L` |
| `Prerequisites` | Comma-separated list, or `None`. Every entry is required; use `/` for alternatives (`CS 31 / CS 31E, MATH 31A` = one of CS 31 or CS 31E, and MATH 31A). Names must match another row's Course Number exactly. |
| `Corequisites` | Comma-separated list, or `None`. Must be taken earlier or in the same quarter; each pair must list each other. |
| `Description` | Course title/description |
| `Units` | Course units. If there's no `Units` column, the `Difficulty` column is used as units. |

A course becomes eligible once every prerequisite entry is met (any one course in a `/` group). Prerequisites that point at a course disabled in the Raw Data view are ignored.

## How the scheduler decides what to take next

There are two planners (switch in **More settings → Planner**):

- **Optimal** (default) — `solver.js` turns the plan into a mixed-integer program and solves it with [HiGHS](https://highs.dev/) (WebAssembly, loaded from jsDelivr) in a Web Worker (`solver-worker.js`). One yes/no variable per (course, term); constraints for prerequisites (any course of a `/` group, in an earlier term), corequisites (earlier or same term), the unit cap per term, and graduation targets. The objective places as many courses as possible (required ones first), as early as possible (bottleneck and required courses most), while keeping each term near the target load. On the sample CSV it finds a proven-optimal plan in about 0.3–2 s. If HiGHS can't load or run, the app falls back to the quick planner automatically.
- **Quick** — the original greedy planner below, which fills one term at a time.

The quick planner is a **priority-based topological scheduler**, not a simple sort by course number or difficulty:

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
     -  2 × units
   ```

4. Requirement weights come from the category priority order in Advanced Settings (drag to reorder): ranks get 40, 35, 30, 28, 24, 20, 18, 12, 8, 5, then 3 less per rank (minimum 1). The default order is Major Core > Capstone > Lower Div > External > 5 Elective > TB > GE > Probability > Stats & DS Minor > ST > Grad Level. A course in several categories uses its highest weight.
5. Generate combinations of up to 5 eligible courses and pick the best-scoring one that fits the remaining unit budget. Max units per term is derived from your course list and timeline (at least 12, and never below your largest course) unless you override it; Fastest mode adds 4.
6. Summer terms, locked terms, and pinned courses are kept as-is. Their courses count as completed only for later terms, and a pinned course's prerequisites must be scheduled before it.

**Bottleneck courses** — ones that unlock many future required courses (e.g. `CS 35L` → `CS 111`/`CS 131` → `CS 130`) — are prioritized over courses that are merely required but low-impact.

## Current implementation status

This section tracks the project against the four-version roadmap outlined by the project mentor (see the `Course Planner` project in et-al for the full objective/task breakdown).

| Version | Scope | Status |
|---|---|---|
| **V1 — Reliable planning engine** | Prerequisite/corequisite/unit validation, dependency graph, requirement tracking | Mostly built. Missing: richer per-course schema (`offered_terms`, `workload_type`, explicit `unlocks`), duplicate-requirement detection, graduation-date feasibility checks |
| **V2 — Personalized optimization** | Weighted scoring, combinatorial quarter selection | Mostly built. Missing: multiple named plan variants (fastest / balanced / interest-focused / flexible-with-backups), interest-alignment and graduation-speed scoring terms, alternative-plan comparison UI |
| **V3 — AI copilot** | Natural-language constraint parsing, planning chat | Not started |
| **V4 — Recovery agent** | Handle unavailable courses, propose alternatives with trade-off explanations | Not started |
| **Backend & database** | FastAPI services, Postgres persistence, plan versioning | Partial — optional Supabase auth + one `user_data` row per user (RLS); no plan versioning or server-side planning |
| **Evaluation plan** | Benchmark suite, metrics, user study | Not started |

## Architecture (current)

Static frontend — `index.html`, `styles.css`, `script.js` — served from GitHub Pages. Course data is loaded from a pasted TSV link or uploaded CSV. The plan auto-saves to localStorage on every change. Signing in (Supabase email auth, configured in `supabase-config.js`, schema in `supabase-schema.sql`) adds Save/Load to Account; on sign-in the account copy loads unless this browser has newer changes. There are no plan versions yet.

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

## Testing

```
npm install        # one dev dependency: highs (the solver, for Node)
npm test           # rules + regression + solver unit tests (node --test)
npm run compare    # side-by-side table: quick vs optimal planner on every fixture
```

The suite loads the real `script.js` into a Node VM with a minimal fake DOM, so it tests the code the browser runs. `tests/fixtures.js` holds the inputs: the sample CSV under several settings, seeded synthetic catalogs (`tests/helpers/catalogs.js`: deeper chains, OR-groups, corequisite pairs, graduation targets, an over-capacity stress case), and hand-written edge cases. For every fixture, both planners must satisfy every rule in `tests/helpers/invariants.js` (each course once; prerequisites earlier; corequisites earlier or same term; unit cap; locked terms, pins, and graduation targets respected), and the optimal planner must leave out no more required courses than the quick one. `tests/regressions.test.js` has one test per bug fixed in the October 2026 review. CI runs the suite on every push and posts the comparison table to the run summary.

## Files

- `index.html` / `styles.css` / `script.js` — the app
- `solver.js` / `solver-worker.js` — the optimal planner (integer-program model + HiGHS Web Worker)
- `tests/` — test suite and planner comparison (`npm test`, `npm run compare`)
- `supabase-config.js` / `supabase-schema.sql` — optional account sync (project URL + public key, and the `user_data` table with row-level security)
- `course_scheduler_algorithm_spec.md` — detailed algorithm spec (priority scoring, workload balancing, edge cases)
- `instructions.md` — end-user setup instructions for the Google Sheets template
- `DANIELLEHON-FINAL_*.csv` — sample course list

## Roadmap

See the `Course Planner` project workspace in et-al for the live objective/task breakdown (V1 gap-closing, V2 multi-plan generation, V3 AI copilot, V4 recovery agent, backend/DB migration, and the evaluation plan).
