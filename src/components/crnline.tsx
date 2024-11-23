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

export default CrnLine;