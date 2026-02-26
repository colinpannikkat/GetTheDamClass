import React, { useState }  from 'react';
import { unsubCourse, updateNotifyWaitlist } from '../helpers';

export interface Course {
    name: string;
    crn: string;
    waitlist_notify: boolean;
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
    const [isWaitlistNotified, setIsWaitlistNotified] = useState(course.waitlist_notify);

    const handleEndNotify = () => {
        unsubCourse(course.crn);
        setIsNotified(false);
    };

    const handleNotifyWaitlist = () => {
        updateNotifyWaitlist(course.crn, isWaitlistNotified);
        setIsWaitlistNotified(!isWaitlistNotified);
    }

    return (
        <div className="CourseLine">
            <div className="text">
                <p id="course_name" style={{ textDecoration: isNotified ? 'none' : 'line-through' }}>
                    {course.name}
                </p>
                <p style={{ textDecoration: isNotified ? 'none' : 'line-through' }}>({course.crn})</p> 
            </div>
            <p
                className="notifyWaitlist"
                style={{
                    marginTop: '0.25rem',
                    fontSize: '1rem',
                    textDecoration: isNotified ? 'none' : 'line-through'
                }}
            >
                <label style={{ fontWeight: 'normal', cursor: 'pointer' }}>
                    <input
                        type="checkbox"
                        checked={isWaitlistNotified}
                        onChange={handleNotifyWaitlist}
                        style={{ marginRight: '0.5em' }}
                    />
                    Notify Waitlist
                </label>
            </p>
            <div className="EndNotify">
                <button onClick={handleEndNotify}>End Notify</button>
            </div>
        </div>
    )
}

export { CourseLine };