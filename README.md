# Interactive 4 Year College Course Planner

An intelligent, interactive course planner that optimizes your 4-year college plan by automatically managing prerequisites, balancing academic load, and creating personalized semester schedules. Built with React and featuring drag-and-drop functionality, this tool takes the complexity out of academic planning.

## 🚀 Quick Start

1. **Prepare Your Data**: Use the provided Google Sheets template to enter your courses
2. **Import Data**: Upload via file, URL, or direct Google Sheets integration
3. **Configure Settings**: Set your academic system, timeline, and preferences
4. **Generate Plan**: Let the AI optimize your 4-year schedule
5. **Fine-tune**: Drag courses to adjust placement as needed

## 🎯 Key Features

### Smart Course Planning Engine
- **Intelligent Auto-Planning**: Automatically places courses based on prerequisites, unit load (12-16 units), difficulty balancing (1-8 scale), and priority order
- **Prerequisite Management**: Real-time validation of all course prerequisites and corequisites with visual dependency graphs
- **Conflict Resolution**: Automatically detects and resolves scheduling conflicts while explaining placement decisions
- **Dynamic Optimization**: Recalculates optimal placement as you modify your plan

### Interactive Visual Interface
- **Drag & Drop Planning**: Intuitive course placement with real-time visual feedback
- **Prerequisite Visualization**: Dynamic lines showing course dependencies and requirements
- **Color-Coded System**: 
  - Red: Unmet prerequisites
  - Blue: Valid placements
  - Gray: Completed courses
- **Responsive Design**: Works seamlessly on desktop and mobile devices

### Flexible Data Management
- **Multiple Input Methods**:
  - Local TSV/TXT file upload
  - Direct URL data loading from published Google Sheets
- **Real-time Validation**: Immediate feedback on data format and content issues
- **Export & Sharing**: Download your plan as TSV or share visual layouts

### Advanced Configuration
- **Academic System Support**: Configurable for quarter or semester systems
- **Customizable Constraints**: Set unit limits, difficulty thresholds, and graduation timeline (2-5 years)
- **Locked Quarters**: Protect completed terms from accidental changes
- **Pinned Courses**: Manually override automatic placement for specific courses

### Step-by-Step Setup Wizard
- **Guided Configuration**: 3-step process with embedded tutorial video
- **Template Access**: Direct link to pre-configured Google Sheets template
- **Validation Feedback**: Clear error messages with actionable suggestions
- **Contextual Help**: Tooltips and guidance throughout the interface

### Optimization Algorithms
- **Multi-Factor Scoring**: Considers unit load, difficulty distribution, priority order, and timeline constraints
- **Three-Phase Placement**: Primary, secondary, and tertiary optimization passes
- **Corequisite Grouping**: Automatically schedules courses that must be taken together
- **Summer Term Integration**: Includes summer sessions for prerequisite completion

### Data Validation & Error Prevention
- **Prerequisite Existence Check**: Validates all prerequisites exist in your course list
- **Circular Dependency Detection**: Prevents impossible scheduling scenarios
- **Self-referencing Prevention**: Blocks courses from referencing themselves as prerequisites
- **Format Validation**: Ensures proper data structure and required columns

### Educational Support Features
- **Course Information Display**: Detailed descriptions and metadata for each course
- **Prerequisite Chains**: Visual representation of complex course sequences
- **Term Summaries**: Unit and difficulty totals for each quarter/semester
- **Progress Tracking**: Visual completion status across your academic timeline


This tool transforms complex academic planning into a visual, interactive experience while ensuring you meet all graduation requirements efficiently.
