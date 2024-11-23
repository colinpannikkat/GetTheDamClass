// https://developer.chrome.com/docs/extensions/reference/api/runtime#event-onInstalled
chrome.runtime.onInstalled.addListener((details) => 
    
    // https://developer.chrome.com/docs/extensions/reference/api/storage/#type-StorageArea
    //Check local storage for email and pin already (if any)
    chrome.storage.local.get(['email', 'pin'], (result) => {

        // If there is no email or pin, show the popup;
        if (!result.email || !result.pin) 
            {
            alert("Please enter your email and pin");

            //Open the signup popup
            chrome.windows.create({
                url: "popup.html",
                type: "popup",
                width: 400,
                height: 400,
                focused: true
            });
        } 
        else 
            {
            console.log(result.email, result.pin);
        }
    })
)