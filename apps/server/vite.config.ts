/**
 * `cf dev` and `cf build` hand the work to Vite, and Cloudflare's plugin is
 * what makes Vite build a Worker (from cloudflare.config.ts) and run it
 * locally in the real Workers runtime.
 */
import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // Vite's dev server answers browsers' CORS preflight requests itself, and
    // only for pages on localhost. Turned off, those requests reach the
    // Worker, which answers them the same way as in production (see
    // src/server.ts).
    cors: false,
    // Links in emails point at port 5173 (`PUBLIC_URL` in
    // cloudflare.config.ts). If that port is taken, stop with an error
    // instead of quietly moving to another one, where those links would
    // reach some other server.
    strictPort: true
  }
})
