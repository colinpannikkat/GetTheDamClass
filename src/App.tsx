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

    const isEmptyCourseList = courseList.length === 0;

    if (loading) {
        return (
            <div className='App'>
                <h1>Loading...</h1>
            </div>);
    } else if (isEmptyCourseList) {
      return (
          <div className="App">
              <h1>No classes currently being monitored...</h1>
          </div>
      );  
    }

    return <App courselist={courseList} />;
};

export default AppWrapper;