import React from 'react';
import { unsubCourse } from '../helpers';

export interface Course {
    name: string;
    crn: string;
}

interface EndNotifyProps {
    crn: string
}

// EndNotify Button component
function EndNotify(props: EndNotifyProps) {
    return (
        <div className="EndNotify">
            <button onClick={() => unsubCourse(props.crn)}>End Notify</button>
        </div>
    )
}

// CourseLine component for extension popout to display a course
// and a button to unsubscribe from course notifications
function CourseLine(course: Course) {
    return (
        <div className="CourseLine">
            <div className="text">
                <p id="course_name">{course.name}</p>
                <p>({course.crn})</p> 
            </div>
            <EndNotify crn={course.crn} />
        </div>
    )
}

export { CourseLine };