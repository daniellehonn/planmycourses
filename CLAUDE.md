# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interactive 4-Year College Course Planner - A web-based drag-and-drop course scheduling tool that optimizes course plans by intelligently mapping prerequisites, balancing difficulty, and creating personalized semester/quarter plans.

## Architecture & Structure

### Core Components
- **Frontend**: Pure HTML/CSS/JavaScript (no frameworks)
- **Data Input**: Google Sheets TSV export integration
- **Planning Engine**: Constraint-based optimization algorithm
- **UI Features**: Drag-and-drop, step-by-step wizard, advanced settings modal

### Key Files
- `index.html`: Main application structure with integrated Google Analytics
- `script.js`: Complete planning logic (2,300+ lines)
- `styles.css`: Responsive design with mobile support
- `instructions.md`: User setup documentation

### Data Flow
1. **Input**: Google Sheets TSV → JavaScript parser → validated course objects
2. **Processing**: Dependency graph construction → constraint satisfaction → optimization
3. **Output**: Interactive drag-and-drop interface with export capability

## Development Commands

### Local Development
```bash
# Serve locally (no build process needed)
python -m http.server 8000
# or
npx serve .

# Open in browser
open http://localhost:8000
```

### Testing & Validation
- No formal test suite - validation done through TSV data validation
- Check browser console for planning algorithm logs (filter for "[Planning]" prefix)
- Use sample TSV data for testing edge cases
- Test file upload with `.tsv` and `.txt` extensions
- Test URL loading with Google Sheets published TSV format

### Debug Logging
- Enable verbose logging: Check "Show Debug Logs" in advanced settings
- Key console filters: `[Planning]`, `[Validation]`, `[DragDrop]`

## Key Features & Implementation Details

### Course Planning Algorithm (`script.js:1320-1380`)
- **3-Phase Placement**: Primary (optimal), Secondary (minimum units), Tertiary (max utilization)
- **Constraint Types**: Prerequisites, corequisites, unit limits, difficulty balancing
- **Scoring System**: Weighted optimization for units/difficulty distribution

### Data Validation (`script.js:217-336`)
- Duplicate course detection
- Prerequisite cycle detection
- Corequisite symmetry validation
- Missing course reference checking
- TSV format validation with specific column requirements

### UI State Management
- **Pinned Courses**: Fixed placement via `pinnedCourses` Set
- **Locked Quarters**: Quarter-level locking via `lockedQuarters` Set
- **Drag & Drop**: HTML5 native API with visual feedback
- **Settings Persistence**: localStorage for user preferences

### Academic System Support
- **Quarter System**: 4 terms/year (Summer, Fall, Winter, Spring)
- **Semester System**: 2 terms/year (Fall, Spring)
- Dynamic recalculation based on system selection

## Google Sheets Integration

### Required Columns
- **Course Number** (e.g., "CS 101")
- **Prerequisites** (comma-separated course numbers)
- **Corequisites** (comma-separated course numbers)
- **Description** (course description)
- **Units** (numeric, 1-5 typical)
- **Difficulty** (1-8 scale, where 8 is hardest)
- **Taken** (format: "Fall, Year 1" or "Not Assigned")

### Template URL
`https://docs.google.com/spreadsheets/d/11h6T1080j6RTk9EUBoycZvgq-gj-Add7Y0oL3-ztW70/edit?usp=sharing`

### Data Format Notes
- **Course Number**: Must be unique across all courses
- **Prerequisites**: Courses must exist (case-sensitive matching)
- **Taken**: Use "Not Assigned" for future courses, specific format for completed courses
- **Empty cells**: Treated as empty arrays for prerequisites/corequisites

## Configuration Constants

### Planning Constraints (`script.js:17-42`)
```javascript
MAX_UNITS_PER_QUARTER: 16
MIN_UNITS_PER_QUARTER: 12
TARGET_UNITS_PER_QUARTER: 13
MAX_DIFFICULTY_PER_QUARTER: 15
TARGET_DIFFICULTY_PER_QUARTER: 12
```

### Scoring Weights
- Under minimum units: +300 bonus
- Over maximum units: -1000 penalty
- Target difficulty: +100 bonus
- Later quarter placement: -15 penalty per quarter

## Common Development Tasks

### Adding New Course Attributes
1. Update TSV parser in `processTSVData()` (script.js:240-290)
2. Add validation in `validateTSVData()` (script.js:300-336)
3. Update UI rendering in `createClassCard()` (script.js:450-500)
4. Modify export format in `downloadPlan()` (script.js:1800-1850)

### Customizing Planning Algorithm
- Adjust scoring weights in `PLANNING_CONFIG.SCORING` (script.js:24-33)
- Modify placement phases in `autoPlanCoreCourses()` (script.js:1320-1380)
- Add new constraints in validation functions (script.js:340-400)

### Mobile Responsiveness
- All styles use mobile-first approach
- Touch-friendly drag targets (minimum 44x44px)
- Responsive grid layouts in CSS
- Test with device emulation in Chrome DevTools

### Adding New Academic Systems
- Update `currentAcademicSystem` state handling
- Modify quarter/semester generation logic
- Update UI labels in `generateQuarterHeaders()`

## Browser Compatibility
- **Modern Browsers**: Full support (Chrome 60+, Firefox 55+, Safari 12+)
- **Mobile**: iOS Safari 12+, Chrome Mobile 60+
- **IE**: Not supported (uses modern JS features)

## Performance Considerations
- **Lazy Loading**: Courses loaded on-demand via TSV
- **Efficient DOM Updates**: Full re-render on state changes
- **Algorithm Complexity**: O(n²) worst case for large course lists (>100 courses)
- **Memory Usage**: All data stored in-memory, no pagination
- **Rendering**: Virtual scrolling not implemented - avoid >200 courses

## Security Notes
- No server-side code (client-side only)
- TSV data validation prevents XSS through HTML escaping
- Google Analytics integration via gtag.js with anonymized IP
- All external links use `rel="noopener noreferrer"`
- File upload restricted to `.tsv` and `.txt` extensions only