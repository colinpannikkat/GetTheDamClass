import {Course, CourseLine} from './components/courseline'
import { getCourseList } from './helpers';

const courseList: Course[] = getCourseList();

function App() {
    return (
      <div className="App">
        <h1>GetTheDamClass: Active Courses</h1>
        {courseList.map((course) => (
            <CourseLine
                name={course.name} 
                crn={course.crn}
            />
        ))}
        <CourseLine name={"APPLIED DIFFERENTIAL EQUATIONS"} crn={"37631"} />
        <CourseLine name={"DEEP LEARNING"} crn={"37631"} />
      </div>
    );
  }
  
export default App;