chrome.runtime.onInstalled.addListener((e=>chrome.storage.local.get(["email","pin"],(e=>{e.email&&e.pin?console.log(e.email,e.pin):chrome.windows.create({url:"src/popup.html",type:"popup",width:400,height:400,focused:!0})}))));