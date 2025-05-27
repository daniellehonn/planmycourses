# Course Planner Setup Instructions

## Step 1: Access the Template
1. Open the Google Sheets template: [Course Planner Template](https://docs.google.com/spreadsheets/d/1IkugQtWd_GgqWf7J7NXUQ3XwH0jD0YoG5QRHAMxUFn4/edit?usp=sharing)
2. Click **File** → **Make a copy** to create your own version
3. 

## Step 2: Customize Your Course List
1. **Replace the sample courses** with the classes you want to take
2. **Order courses by priority** - list your most important courses first, as the algorithm will prioritize them in this order
3. **Set difficulty levels** (optional):
   - Research each course's workload and assign difficulty ratings
   - If you prefer to skip this step, set all courses to difficulty level "1"

### Required Information for Each Course:
- **Course Number** (e.g., "CS 101")
- **Prerequisites** (list any required courses that must be completed first)
    - `None` if no prerequisites are required
    - Otherwise, list the course number of the prerequisite course(s) separated by commas
    - **Important**: The prerequisite course(s) must also be listed on the spreadsheet and the name must match exactly
- **Corequisites** (list any courses that must be taken concurrently)
    - `None` if no corequisites are required
    - Otherwise, list the course number of the corequisite course(s) separated by commas
    - **Important**: Corequisite courses will be automatically placed in the same quarter
    - The corequisite course(s) must also be listed on the spreadsheet and the name must match exactly
- **Units** (number of units the course is worth)
- **Difficulty** (1-8, where 1 is easiest and 8 is hardest)

## Step 3: Export Your Data  
1. In your Google Sheet, go to **File** → **Share** → **Publish to web**
2. In the dropdown menu, change from "Web page" to **"Tab-separated values (.tsv)"**
3. Click **Publish** and copy the generated link

## Step 4: Connect to Course Planner
1. Paste the copied link into your course planner tool
2. **Important**: Verify the link ends with `output=tsv` before submitting

Your course planner is now ready to generate your personalized schedule!