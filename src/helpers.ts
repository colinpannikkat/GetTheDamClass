import { Course } from "./components/courseline";

// Gets an email an pin from local storage, if it doesn't exist in local storage then it prompts
// the user to sign up with the SignupPopup page
async function getEmailAndPinPromise(): Promise<[string, string]> {

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

// Gets an email an pin from local storage, if it doesn't exist in local storage then it prompts
// the user to sign up with the SignupPopup page
function getEmailAndPin(): [string, string]{
    chrome.storage.local.get(['email', 'pin'], (result) => {
        if (result.email && result.pin) {
            return [result.email, result.pin];
        } else {
            // Send message to background.js to do signup popup
            chrome.runtime.sendMessage({action: "signup"}, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Error:", chrome.runtime.lastError.message);
                    return new Error(chrome.runtime.lastError.message);
                }
                if (response && response.success) {
                    console.log("Signup form completed");
                    chrome.storage.local.get(['email', 'pin'], (result) => {
                        if (result.email && result.pin) {
                            return [result.email, result.pin];
                        } else {
                            return new Error("Still no email and pin in local storage.");
                        }
                    });
                } else {
                    console.log("No response or unsuccessful");
                    return new Error("No response or unsuccessful");
                }
            });
        }
    })
    return ["", ""]
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


const test_subs = {
    subs : [
        {
            crn: "39835",
            name: "INTRO TO DEEP LEARNING"
        },
        {
            crn: "37429",
            name: "TRUSTWORTHY ML"
        }
    ]
}

function getCourseList(): Course[] {
    let [email, pin]: [string, string] = getEmailAndPin();
    const payload : SubListPayload = createSubListPayload(email, pin);

    fetch("https://api.getthedamclass.sarvesh.me/getsubs", {
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
    });

    // Temporary until endpoint is up
    return test_subs.subs;
}

// Unsub function
function unsubCourse(crn: string) {

    let [email, pin]: [string, string] = getEmailAndPin();
    const payload : SubscribePayload = createSubscribePayload(crn, email, pin);

    fetch("https://api.getthedamclass.sarvesh.me/unsub", {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            'Access-Control-Allow-Credentials' : 'true',
            'Access-Control-Allow-Origin':'*',
            'Access-Control-Allow-Methods':'POST',
            'Access-Control-Allow-Headers':'application/json',
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
        console.log("Cancellation of subscription successful:", data);
    })
    .catch(error => {
        console.error("Error:", error);
        // alert("Cancellation of subscription failed: " + error.message);
    });
}

// 1: make post request to AJs endpoint for the crns (see backend docs0
// Get json object of crns in the name
// Some function which returns that list 
// Call that function in index.tsx)

export {getEmailAndPin, getEmailAndPinPromise, createSubscribePayload, createSignupPayload, getCourseList, unsubCourse};
export type {SubscribePayload, SignupPayload};