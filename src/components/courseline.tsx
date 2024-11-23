import React from 'react';

export interface Course {
    name: string;
    crn: number;
}

function EndNotify() {
    return (
        <div className="EndNotify">
            <button>End Notify</button>
        </div>
    )
}

function CourseLine(course: Course) {
    return (
        <div className="CourseLine">
            <div className="text">
                <p id="course_name">{course.name}</p>
                <p>({course.crn})</p> 
            </div>
            <EndNotify />
        </div>
    )
}

export default CourseLine;