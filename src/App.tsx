export interface Course {
    name: string;
}

function CrnLine(course: Course) {
    return (
        <div className="crnLine">
            <p>{course.name}</p> <button>End Notify</button>
        </div>
    )
}

function App() {
    return (
      <div className="App">
        <CrnLine name={"Test"} />
        <CrnLine name={"Test"} />
      </div>
    );
  }
  
export default App;