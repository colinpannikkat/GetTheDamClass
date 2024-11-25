# GetTheDamClass

Class vacancy notifier Chrome extension for Oregon State University.

We have a backend server running on a private VPS to track course vacancies and alert students. The backend code can be found [here](https://github.com/aj-arts/GetTheDamClass-Backend).

## Adding the Chrome Extension

1. Download the latest release from the [releases page](https://github.com/aj-arts/GetTheDamClass/releases).
2. Extract the downloaded zip file to a location on your local machine.
3. Open Chrome and navigate to `chrome://extensions`.
4. Enable "Developer mode" by toggling the switch in the top right corner.
5. Click on the "Load unpacked" button and select the extracted folder.
6. The extension should now be added to Chrome and ready to use.

We will hopefully have it released on the Chrome Web Store soon!

## Build Info

If you'd like to build this extension from scratch you can also do so.

### Installation

To install all node packages first run:

#### `npm install`

Then, in the project directory, you can run:

#### `npm run build`

Which builds the extension to the `dist` folder, which you can then load into your browser by going to `chrome://extensions` and clicking `Load unpacked`, which you can then load the build and use in your browser.

This project was bootstrapped with [Create React App](https://github.com/facebook/create-react-app).

---
&copy; 2024 Nothing Suspicious (Colin Pannikkat, Ajinkya Gokule, David Gesl, Sarvesh Thiruppathi Ahila)
