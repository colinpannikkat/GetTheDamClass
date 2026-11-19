import tailwindcss from "@tailwindcss/vite"
import { defineConfig } from "wxt"

// WXT generates manifest.json from this file plus the files in `entrypoints/`.
// See https://wxt.dev/guide/essentials/config/manifest.html
export default defineConfig({
  modules: ["@wxt-dev/module-react"],

  // Auto-imports are switched off on purpose: every file lists its imports, so
  // you can always see where a name comes from.
  imports: false,

  manifest: {
    name: "GetTheDamClass",
    description: "This is a Chrome extension for class vacancy notification",
    // `version` is taken from this folder's package.json (not the one at the
    // repository root).
    permissions: ["storage"],
    // No `host_permissions`: the backend allows cross-origin requests (CORS),
    // so the extension does not need access to any site.
    icons: {
      16: "icons/icon16.png",
      32: "icons/icon32.png",
      48: "icons/icon48.png",
      128: "icons/icon128.png"
    },
    action: {
      default_title: "GetTheDamClass"
    },
    // The class search may show our sign-in page in a frame (and no other
    // site may). See entrypoints/signin/SignInFrame.tsx. WXT adds a second
    // entry by itself, for the stylesheet of the "Notify me" button.
    web_accessible_resources: [
      { resources: ["signin.html"], matches: ["https://classes.oregonstate.edu/*"] }
    ]
  },

  vite: () => ({
    plugins: [tailwindcss()]
  })
})
