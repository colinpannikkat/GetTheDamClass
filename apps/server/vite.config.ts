/**
 * `cf dev` and `cf build` hand the work to Vite, and Cloudflare's plugin is
 * what makes Vite build a Worker (from cloudflare.config.ts) and run it
 * locally in the real Workers runtime.
 */
import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [cloudflare()]
})
