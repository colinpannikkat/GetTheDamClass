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
    // Cloudflare updates the Workers runtime all the time. Changes that could
    // break existing code are switched on by date, and a Worker only gets the
    // ones dated on or before this. Move it forward on purpose, and test.
    compatibilityDate: "2026-11-17"
  }
})
