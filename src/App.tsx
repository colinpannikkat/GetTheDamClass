import {Course, CourseLine} from './components/courseline'
import { getCourseList } from './helpers';
import React, { useEffect, useState } from 'react';

interface AppProps {
    courselist: Course[]
}

function App(props : AppProps) {
    return (
        <div className="App">
            <h1>GetTheDamClass: Active Courses</h1>
            {props.courselist.map((course) => (
                <CourseLine
                    name={course.name} 
                    crn={course.crn}
                />
            ))}
            {/* <CourseLine name={"APPLIED DIFFERENTIAL EQUATIONS"} crn={"37631"} /> */}
            {/* <CourseLine name={"DEEP LEARNING"} crn={"37631"} /> */}
        </div>
    );
}

const AppWrapper: React.FC = () => {
    const [courseList, setCourseList] = useState<Course[]>([]);
    const [loading, setLoading] = useState<boolean>(true);

    useEffect(() => {
        const fetchCourses = async () => {
            const courses = await getCourseList();
            setCourseList(courses);
            setLoading(false);
        };
        fetchCourses();
    }, []);

    if (loading) {
        return (
            <div className='App'>
                <h1>GetTheDamClass: Active Courses</h1>
                <div className="CourseLine">
                    <p>Loading...</p>
                </div>
            </div>);
    }

    return <App courselist={courseList} />;
};

export default AppWrapper;