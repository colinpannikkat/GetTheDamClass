import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  imports: false,

  manifest: {
    name: "GetTheDamClass",
    description: "This is a Chrome extension for class vacancy notification",
    permissions: ["storage"],
    // No `host_permissions`: the server allows cross-origin requests.
    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png"
    },
    action: {
      default_title: "GetTheDamClass"
    },
    // Only the class search may frame our sign-in page. WXT adds a second entry itself, for the
    // "Notify me" stylesheet.
    web_accessible_resources: [
      { resources: ["signin.html"], matches: ["https://classes.oregonstate.edu/*"] }
    ]
  },

  vite: () => ({
    plugins: [tailwindcss()]
  })
})
