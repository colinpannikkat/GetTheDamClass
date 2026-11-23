import { cloudflare } from "@cloudflare/vite-plugin"
import { defineConfig } from "vite"

export default defineConfig({
  plugins: [cloudflare()],
  server: {
    // Off, so CORS preflights reach the Worker, which answers them as in production.
    cors: false,
    // Links in emails point at port 5173 (`PUBLIC_URL`), so fail rather than move to another port.
    strictPort: true
  }
})
