/**
 * The Worker's settings for Cloudflare: its name, its code, and which version
 * of the Workers runtime it expects. `cf dev`, `cf build` and `cf deploy` all
 * read this file. (It replaces the `wrangler.toml` older projects have.)
 * See https://developers.cloudflare.com/cf/projects/cloudflare-config/
 */
import { defineConfig } from "cf/config"

export default defineConfig({
  worker: {
    name: "getthedamclass",
    entrypoint: "./src/index.ts",
    // Cloudflare keeps a Worker on the runtime behaviour of this date, so an
    // update to the runtime never changes how a deployed Worker behaves.
    // Move it forward on purpose, and test, when a newer behaviour is wanted.
    compatibilityDate: "2026-11-17"
  }
})
