import React, { useState }  from 'react';
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
    const [isNotified, setIsNotified] = useState(true);

    const handleEndNotify = () => {
        unsubCourse(course.crn);
        setIsNotified(false);
    };

    return (
        <div className="CourseLine">
            <div className="text">
                <p id="course_name" style={{ textDecoration: isNotified ? 'none' : 'line-through' }}>
                    {course.name}
                </p>
                <p style={{ textDecoration: isNotified ? 'none' : 'line-through' }}>({course.crn})</p> 
            </div>
            <div className="EndNotify">
                <button onClick={handleEndNotify}>End Notify</button>
            </div>
        </div>
    )
}

export { CourseLine };