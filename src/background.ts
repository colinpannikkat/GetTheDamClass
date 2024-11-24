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

// https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled
chrome.runtime.onInstalled.addListener((details) => 
    // https://developer.chrome.com/docs/extensions/reference/api/storage/#type-StorageArea
    //Check local storage for email and pin already (if any)
    chrome.storage.local.get(['email', 'pin'], (result) => {

        // If there is no email or pin, show the popup;
        if (!result.email || !result.pin) {
            SignupPopup();
        } else {
            console.log(result.email, result.pin);
        }
    })
)

// Listener to create signup popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Signup message received");
    if (message.action === "signup") {
        SignupPopup();
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
    // sendResponse({ success: false });
    // return false;
});

export {};