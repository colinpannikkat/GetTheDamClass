import { Course } from "./components/courseline";


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

interface SubListPayload {
    email: FormDataEntryValue;
    pin: FormDataEntryValue;
}

function createSubListPayload(email: FormDataEntryValue, pin: FormDataEntryValue): SubListPayload {
    return {
        email,
        pin
    };
}


function createSignupPayload(email: FormDataEntryValue, pin: FormDataEntryValue): SignupPayload {
    return {
        email,
        pin
    };
}

async function getList(): Promise <[Course]> {
    let [email, pin]: [string, string] = await getEmailAndPin();
    const payload : SubListPayload = createSubListPayload(email, pin);

    return fetch("https://api.getthedamclass.sarvesh.me/getsubs", {
        method: "POST",
        mode: "no-cors",
        headers: {
            "Content-Type": "application/json",
            // "Access-Control-Allow-Origin": "*"
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
        console.log("Get Sub List successful:", data);
        return data;
    })
    .catch(error => {
        console.error("Error:", error);
        alert("Failed to get sub list: " + error.message);
    });
}

// 1: make post request to AJs endpoint for the crns (see backend docs0
// Get json object of crns in the name
// Some function which returns that list 
// Call that function in index.tsx)

export {getEmailAndPin, createSubscribePayload, createSignupPayload, getList};
export type {SubscribePayload, SignupPayload};