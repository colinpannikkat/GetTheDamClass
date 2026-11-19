/**
 * The test setup. That this file exists matters more than what is in it:
 * without it, Vitest would load vite.config.ts, and Cloudflare's plugin there
 * would start a local Workers runtime that the tests never use. (They run in
 * Node and call the Worker's `fetch` directly; see src/index.test.ts.)
 */
import { defineConfig } from "vitest/config"

export default defineConfig({})
