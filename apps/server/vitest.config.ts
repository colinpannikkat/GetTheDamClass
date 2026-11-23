// Must exist: without it Vitest would load vite.config.ts, whose Cloudflare plugin starts an unused Workers runtime.
import { defineConfig } from "vitest/config"

export default defineConfig({})
