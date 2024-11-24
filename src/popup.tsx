import React from 'react';
import ReactDOM from 'react-dom/client';
import SignupForm from './components/signupform';
import "./App.css";

const root = document.createElement("div")
root.className = "popup-container"

// Set body for flex
document.body.style.display = "flex";
document.body.style.justifyContent = "center";
document.body.style.alignItems = "center";
document.body.style.height = "100vh";
document.body.appendChild(root);
const rootDiv = ReactDOM.createRoot(root);

rootDiv.render(
  <React.StrictMode>
    <SignupForm /> 
  </React.StrictMode>
);
