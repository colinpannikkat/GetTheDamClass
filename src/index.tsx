import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import AppWrapper from './App';
import "./App.css";

const root = document.createElement("div")
root.className = "container"
document.body.appendChild(root)
const rootDiv = ReactDOM.createRoot(root);

rootDiv.render(
  <React.StrictMode>
    <AppWrapper />        
  </React.StrictMode>
);

const footer = document.createElement("footer");
footer.className = "footer";
footer.innerHTML = "<p>&copy; 2024 NothingSuspicious</p>";
document.body.appendChild(footer);