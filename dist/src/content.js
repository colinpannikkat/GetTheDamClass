(()=>{"use strict";function e(){return e=this,n=void 0,r=function(){return function(e,n){var t,r,o,i,u={label:0,sent:function(){if(1&o[0])throw o[1];return o[1]},trys:[],ops:[]};return i={next:c(0),throw:c(1),return:c(2)},"function"==typeof Symbol&&(i[Symbol.iterator]=function(){return this}),i;function c(c){return function(a){return function(c){if(t)throw new TypeError("Generator is already executing.");for(;i&&(i=0,c[0]&&(u=0)),u;)try{if(t=1,r&&(o=2&c[0]?r.return:c[0]?r.throw||((o=r.return)&&o.call(r),0):r.next)&&!(o=o.call(r,c[1])).done)return o;switch(r=0,o&&(c=[2&c[0],o.value]),c[0]){case 0:case 1:o=c;break;case 4:return u.label++,{value:c[1],done:!1};case 5:u.label++,r=c[1],c=[0];continue;case 7:c=u.ops.pop(),u.trys.pop();continue;default:if(!((o=(o=u.trys).length>0&&o[o.length-1])||6!==c[0]&&2!==c[0])){u=0;continue}if(3===c[0]&&(!o||c[1]>o[0]&&c[1]<o[3])){u.label=c[1];break}if(6===c[0]&&u.label<o[1]){u.label=o[1],o=c;break}if(o&&u.label<o[2]){u.label=o[2],u.ops.push(c);break}o[2]&&u.ops.pop(),u.trys.pop();continue}c=n.call(e,u)}catch(e){c=[6,e],r=0}finally{t=o=0}if(5&c[0])throw c[1];return{value:c[0]?c[1]:void 0,done:!0}}([c,a])}}}(this,(function(e){return[2,new Promise((function(e,n){chrome.storage.local.get(["email","pin"],(function(t){t.email&&t.pin?e([t.email,t.pin]):chrome.runtime.sendMessage({action:"signup"},(function(t){if(chrome.runtime.lastError)return console.error("Error:",chrome.runtime.lastError.message),void n(new Error(chrome.runtime.lastError.message));t&&t.success?(console.log("Signup form completed"),chrome.storage.local.get(["email","pin"],(function(t){t.email&&t.pin?e([t.email,t.pin]):n(new Error("Still no email and pin in local storage."))}))):(console.log("No response or unsuccessful"),n(new Error("No response or unsuccessful")))}))}))}))]}))},new((t=void 0)||(t=Promise))((function(o,i){function u(e){try{a(r.next(e))}catch(e){i(e)}}function c(e){try{a(r.throw(e))}catch(e){i(e)}}function a(e){var n;e.done?o(e.value):(n=e.value,n instanceof t?n:new t((function(e){e(n)}))).then(u,c)}a((r=r.apply(e,n||[])).next())}));var e,n,t,r}var n=function(e,n,t,r){return new(t||(t=Promise))((function(o,i){function u(e){try{a(r.next(e))}catch(e){i(e)}}function c(e){try{a(r.throw(e))}catch(e){i(e)}}function a(e){var n;e.done?o(e.value):(n=e.value,n instanceof t?n:new t((function(e){e(n)}))).then(u,c)}a((r=r.apply(e,n||[])).next())}))},t=function(e,n){var t,r,o,i,u={label:0,sent:function(){if(1&o[0])throw o[1];return o[1]},trys:[],ops:[]};return i={next:c(0),throw:c(1),return:c(2)},"function"==typeof Symbol&&(i[Symbol.iterator]=function(){return this}),i;function c(c){return function(a){return function(c){if(t)throw new TypeError("Generator is already executing.");for(;i&&(i=0,c[0]&&(u=0)),u;)try{if(t=1,r&&(o=2&c[0]?r.return:c[0]?r.throw||((o=r.return)&&o.call(r),0):r.next)&&!(o=o.call(r,c[1])).done)return o;switch(r=0,o&&(c=[2&c[0],o.value]),c[0]){case 0:case 1:o=c;break;case 4:return u.label++,{value:c[1],done:!1};case 5:u.label++,r=c[1],c=[0];continue;case 7:c=u.ops.pop(),u.trys.pop();continue;default:if(!((o=(o=u.trys).length>0&&o[o.length-1])||6!==c[0]&&2!==c[0])){u=0;continue}if(3===c[0]&&(!o||c[1]>o[0]&&c[1]<o[3])){u.label=c[1];break}if(6===c[0]&&u.label<o[1]){u.label=o[1],o=c;break}if(o&&u.label<o[2]){u.label=o[2],u.ops.push(c);break}o[2]&&u.ops.pop(),u.trys.pop();continue}c=n.call(e,u)}catch(e){c=[6,e],r=0}finally{t=o=0}if(5&c[0])throw c[1];return{value:c[0]?c[1]:void 0,done:!0}}([c,a])}}};function r(r){return n(this,void 0,void 0,(function(){var n,o,i,u;return t(this,(function(t){switch(t.label){case 0:return[4,e()];case 1:return n=t.sent(),o=n[0],i=n[1],u=function(e,n,t){return{crn:e,email:n,pin:t}}(r,o,i),fetch("https://api.getthedamclass.sarvesh.me/sub",{method:"POST",headers:{"Content-Type":"application/json","Access-Control-Allow-Credentials":"true","Access-Control-Allow-Origin":"*","Access-Control-Allow-Methods":"POST","Access-Control-Allow-Headers":"application/json"},body:JSON.stringify(u)}).then((function(e){if(!e.ok)throw new Error("HTTP error! status: ".concat(e.status));return e.json()})).then((function(e){console.log("Subscription successful:",e)})).catch((function(e){console.error("Error:",e),alert("Subscription failed: "+e.message)})),[2]}}))}))}MutationObserver=window.MutationObserver,new MutationObserver((function(e){var o=document.querySelector("div.button-bar.button-bar--right-align");e.forEach((function(){o&&!o.querySelector("button[cumbutton='true']")&&o.prepend(function(){var e,o,i=this,u=document.createElement("button");u.textContent="Notify Me",u.className="btn";var c=null===(e=document.querySelector("div.dtl-section"))||void 0===e?void 0:e.textContent;if(null==c||null==c)throw Error("No CRN found on page");var a=null===(o=c.match(/CRN (\d+)/))||void 0===o?void 0:o[1];if(!a)throw Error("CRN is undefined");return null==u||u.addEventListener("click",(function(){return n(i,void 0,void 0,(function(){return t(this,(function(e){switch(e.label){case 0:return[4,r(a)];case 1:return[2,e.sent()]}}))}))})),u.setAttribute("cumbutton","true"),u}())}))})).observe(document,{subtree:!0,attributes:!0})})();