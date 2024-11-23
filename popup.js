/**
 * Event listener for the submit event of the signup form.
 * Stores the user's email and pin in the local storage and closes the popup window.
 *
 * @param {Event} event - The submit event object.
 */

document.getElementById("signupForm").addEventListener("submit", function(event) {
    event.preventDefault();
    const user_email = document.getElementById("email").value;
    const user_pin = document.getElementById("pin").value;
asd
    /**
     * Save the user's email and pin in the chromne local storage.
     *
     * @param {Object} items - An object containing the email and pin as key-value pairs.
     */
    chrome.storage.local.set({ email: user_email, pin: user_pin }, function(){
        console.log("Email and PIN saved successfully");
    });

    window.close();
});