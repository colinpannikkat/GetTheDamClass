import React from 'react';
import ReactDOM from 'react-dom/client';
import SignupForm from './components/signupform';
import "./App.css";

const root = document.createElement("div")
root.className = "popup-container"        //This is throwing off the styles for the popup page 
document.body.appendChild(root)
const rootDiv = ReactDOM.createRoot(root);

rootDiv.render(
  <React.StrictMode>
    <SignupForm /> 
  </React.StrictMode>
);
