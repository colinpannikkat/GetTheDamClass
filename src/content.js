MutationObserver = window.MutationObserver;

function notifyMe() {
    console.log("Notification button clicked");
}

function createButtonDiv() {
    const newButton = document.createElement("button");
    newButton.textContent =  "Notify Me";
    newButton.className = "btn";
    newButton.addEventListener("click", notifyMe);
    newButton.setAttribute("cumbutton", "true");
    return newButton;
}

// Callback function which executes given any change to DOM
var observer = new MutationObserver(function(mutations){
    const button_bar_div = document.querySelector("div.button-bar.button-bar--right-align") // bottom button bar element
    mutations.forEach(function(mutation) {
        if (button_bar_div && !button_bar_div.querySelector("button[cumbutton='true']")) {
            button_bar_div.appendChild(createButtonDiv());
        }
    });
});

// Start observing DOM
observer.observe(document, {
    subtree: true,
    attributes: true
});