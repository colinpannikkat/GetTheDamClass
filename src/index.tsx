import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import "./App.css";
import { getCourseList } from './helpers';
import { Course } from './components/courseline';

const courseList: Course[] = getCourseList();

console.log(courseList);

const root = document.createElement("div")
root.className = "container"
document.body.appendChild(root)
const rootDiv = ReactDOM.createRoot(root);

rootDiv.render(
  <React.StrictMode>
    <App />    
  </React.StrictMode>
);

const footer = document.createElement("footer");
footer.className = "footer";
footer.innerHTML = "<p>&copy; 2024 NothingSuspicious</p>";
document.body.appendChild(footer);