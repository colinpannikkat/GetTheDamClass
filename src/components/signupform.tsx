import React from "react";

function SignupForm() {
    function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        const formData = new FormData(e.currentTarget);
        const user_email = formData.get("email");
        const user_pin = formData.get("pin");

        /**
         * Save the user's email and pin in the chromne local storage.
         *
         * @param {Object} items - An object containing the email and pin as key-value pairs.
         */
        chrome.storage.local.set({ email: user_email, pin: user_pin }, function(){
            console.log("Email and PIN saved successfully");
        });

        window.close();
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