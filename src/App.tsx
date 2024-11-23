import CourseLine from './components/courseline'

function App() {
    return (
      <div className="App">
        <h2>Notified courses</h2>
        <CourseLine name={"APPLIED DIFFERENTIAL EQUATIONS APPLIED DIFFERENTIAL EQUATIONS"} crn={37631} />
        <CourseLine name={"DEEP LEARNING"} crn={37631} />
      </div>
    );
  }
  
export default App;