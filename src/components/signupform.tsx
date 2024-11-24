import React from "react";
import { createSignupPayload, SignupPayload } from "../helpers";

// SignupForm component
function SignupForm() {
    function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const user_email = formData.get("email");
        const user_pin = formData.get("pin");

        let payload: SignupPayload | null = null;

        if (user_email && user_pin) {
            payload = createSignupPayload(user_email, user_pin);
        } else {
            console.error("Email or pin is null");
        }
    
        fetch("https://api.getthedamclass.sarvesh.me/signup", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        })
        .then(response => {
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            return response.json()
        })
        .then(data => {
            console.log("Signup successful:", data);
            /**
             * Save the user's email and pin in the chrome local storage.
             * Only saves if the post request to API is successful.
             * 
             * @param {Object} items - An object containing the email and pin as key-value pairs.
             */
            chrome.storage.local.set({ email: user_email, pin: user_pin }, function(){
                console.log("Email and PIN saved successfully");
            });

            // Alert event listener in background that form was submitted and close window
            chrome.runtime.sendMessage({action: "signupComplete"});
            window.close();
        })
        .catch(error => {
            console.error("Error:", error);
            alert("Signup failed: " + error.message);

            // Let event listener know the signup failed
            chrome.runtime.sendMessage({action: "signupFailed"});
        });
    }

    return (
        <div className="signupForm">
            <form id="signupForm" onSubmit={handleSubmit}>
                <label htmlFor="email">Enter your Email:</label>
                <input type="email" id="email" name="email" required></input>
                <br></br><br></br>
                <label htmlFor="pin">PIN:</label>
                <br></br>
                <input type="password" id="pin" name="pin" required></input>
                <div>(This will be used to unsubscribe your email later)</div>
                <br></br><br></br>
                <button type="submit">Submit</button>
            </form>
        </div>
    );
}

export default SignupForm;