import React from 'react';

export interface Course {
    name: string;
}

function CourseLine(course: Course) {
    return (
        <div className="crnLine">
            <p>{course.name}</p> <button>End Notify</button>
        </div>
    )
}

export default CourseLine;