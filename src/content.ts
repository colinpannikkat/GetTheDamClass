import { getEmailAndPinPromise, createSubscribePayload, SubscribePayload} from "./helpers";

MutationObserver = window.MutationObserver;

// Notify function that runs when button is pressed
async function notifyMe(crn: string) {
    let [email, pin]: [string, string] = await getEmailAndPinPromise();
    const payload : SubscribePayload = createSubscribePayload(crn, email, pin);

    fetch("https://api.getthedamclass.sarvesh.me/sub", {
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
        if (response.status === 409) {
            alert("Sub failed: already subscribed");
            return Promise.reject("Subscription was unsuccessful");
        }
        if (!response.ok) {
            console.error(`HTTP error! status: ${response.status}`);
            console.error(response.json())
            return Promise.reject("Subscription was unsuccessful");
        }
        return response.json()
    })
    .then(data => {
        console.log("Subscription successful:", data);
        chrome.runtime.sendMessage({ message: "Notify Button Clicked" });
    })
    .catch(error => {
        console.error("Error:", error);
        alert("Subscription failed: " + error.message);
    });
}

// Function to create a button element on the page
function createButtonDiv(): HTMLButtonElement {
    const newButton = document.createElement("button");
    newButton.textContent =  "Notify Me";
    newButton.className = "btn";

    // Get the dtl-section div, this holds "Section <section_num>, CRN <crn_num>"
    let dtl_section: string | null | undefined = document.querySelector("div.dtl-section")?.textContent;

    if (dtl_section == null || dtl_section == undefined) {
        console.error("No CRN found on page");
    } else {
        // Find matching substring with regex to get crn
        const crn = dtl_section.match(/CRN (\d+)/)?.[1];
        if (crn) {
            newButton?.addEventListener("click", async () => await notifyMe(crn));
            newButton.setAttribute("cumbutton", "true");
        } else {
            console.error("CRN is undefined");
        }    
    }

    return newButton;
}

// Callback function which executes given any change to DOM
var observer = new MutationObserver(function(mutations){
    const button_bar_div = document.querySelector("div.button-bar.button-bar--right-align") // bottom button bar element
    mutations.forEach(function() {
        if (button_bar_div && !button_bar_div.querySelector("button[cumbutton='true']")) {
            button_bar_div.prepend(createButtonDiv());
        }
    });
});

// Start observing DOM
observer.observe(document, {
    subtree: true,
    attributes: true
});

export {};