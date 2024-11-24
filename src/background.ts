import { click } from "@testing-library/user-event/dist/click";

//This script runs in the chrome background so we need to have event listeners here

function SignupPopup() {
    if (typeof chrome !== 'undefined' && chrome.windows) {
        chrome.windows.create({
            url: "src/popup.html",
            type: "popup",
            width: 400,
            height: 400,
            focused: true
        });
    } else {
        console.error("Chrome API is not available.");
    }
}

// function courseAddedNotification() {
    
//     chrome.notifications.create(
//         {
//             type: "basic",
//             iconUrl: "./d.png",
//             title: "Notification Added",
//             message: "Notifications enabled!"
//         },
//         (notificationId) => {
//             if (chrome.runtime.lastError) {
//                 console.error(`Notification creation failed: ${chrome.runtime.lastError.message}`);
//             } else {
//                 console.log(`Notification created with ID: ${notificationId}`);
//             }
//         }
//     );
    
// };

// https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled
chrome.runtime.onInstalled.addListener((details) => 
    // https://developer.chrome.com/docs/extensions/reference/api/storage/#type-StorageArea
    //Check local storage for email and pin already (if any)
    chrome.storage.local.get(['email', 'pin'], (result) => {

        // If there is no email or pin, show the popup;
        if (!result.email || !result.pin) {
            SignupPopup();
        } else {
            console.log("Already signed in");
        }
    })
)

// Listener to create signup popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Signup message received");
    if (message.action === "signup") {
        SignupPopup();

        // This is a second listening so this listener knows when the user
        // has completed the signup
        const signupCompleteListener = (responseMessage: any) => {
            if (responseMessage.action === "signupComplete") {
                sendResponse({ success: true });
                chrome.runtime.onMessage.removeListener(signupCompleteListener);
            } else if (responseMessage.action === "signupFailed") {
                sendResponse({ success: false })
                chrome.runtime.onMessage.removeListener(signupCompleteListener);
            }
        };
        chrome.runtime.onMessage.addListener(signupCompleteListener);
        return true; // keep listener open
    }
});


// //Listener for when the notify button is clicked
// chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
//     console.log("Add notification message received");
//     if (message.action === "Notify Button Clicked") {
//         courseAddedNotification();
//         sendResponse({success : "success"});
//     }
//     return true; // keep listener open
// });

export {};