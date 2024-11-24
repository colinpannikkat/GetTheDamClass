// Gets an email an pin from local storage, if it doesn't exist in local storage then it prompts
// the user to sign up with the SignupPopup page
async function getEmailAndPin(): Promise<[string, string]> {

    // Returning a promise to notifyMe() function
    return new Promise<[string, string]>((resolve, reject) => {
        chrome.storage.local.get(['email', 'pin'], (result) => {
            if (result.email && result.pin) {
                resolve([result.email, result.pin]);
            } else {
                
                // Send message to background.js to do signup popup
                chrome.runtime.sendMessage({action: "signup"}, (response) => {
                    if (chrome.runtime.lastError) {
                        console.error("Error:", chrome.runtime.lastError.message);
                        reject(new Error(chrome.runtime.lastError.message));
                        return;
                    }
                    if (response && response.success) {
                        console.log("Signup form completed");
                        chrome.storage.local.get(['email', 'pin'], (result) => {
                            if (result.email && result.pin) {
                                resolve([result.email, result.pin]);
                            } else {
                                reject(new Error("Still no email and pin in local storage."));
                            }
                        });
                    } else {
                        console.log("No response or unsuccessful");
                        reject(new Error("No response or unsuccessful"));
                    }
                });
            }
        })
    });
}

interface SubscribePayload {
    crn: string;
    email: string;
    pin: string;
}

function createSubscribePayload(crn: string, email: string, pin: string): SubscribePayload {
    return {
        crn,
        email,
        pin
    };
}

interface SignupPayload {
    email: FormDataEntryValue;
    pin: FormDataEntryValue;
}

function createSignupPayload(email: FormDataEntryValue, pin: FormDataEntryValue): SignupPayload {
    return {
        email,
        pin
    };
}

export {getEmailAndPin, createSubscribePayload, createSignupPayload};
export type {SubscribePayload, SignupPayload};