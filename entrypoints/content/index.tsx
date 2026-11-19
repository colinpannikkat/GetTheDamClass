// Placeholder content script. It proves that the build produces a script and
// a stylesheet for the university's class search. The real one (a "Notify me"
// button inside a shadow root) replaces this file.
import "@/assets/tailwind.css"
import { defineContentScript } from "wxt/utils/define-content-script"

export default defineContentScript({
  matches: ["https://classes.oregonstate.edu/*"],
  // "ui": do not inject the stylesheet into the page. WXT's shadow-root helper
  // loads it into our own UI instead, so the page's styles stay untouched.
  cssInjectionMode: "ui",
  main() {
    console.debug("[GetTheDamClass] content script loaded")
  }
})
