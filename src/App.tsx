import {CourseLine} from './components/courseline'

function App() {
    return (
      <div className="App">
        <h1>GetTheDamClass: Active Courses</h1>
        <CourseLine name={"APPLIED DIFFERENTIAL EQUATIONS"} crn={37631} />
        <CourseLine name={"DEEP LEARNING"} crn={37631} />
      </div>
    );
  }
  
export default App;