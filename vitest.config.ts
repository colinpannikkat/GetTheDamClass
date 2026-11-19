import { defineConfig } from "vitest/config"
import { WxtVitest } from "wxt/testing/vitest-plugin"

export default defineConfig({
  // WXT's plugin makes tests see the project the way the build does: the "@/"
  // import alias works, and `browser` (the extension API) is an in-memory fake.
  plugins: [WxtVitest()],
  test: {
    setupFiles: ["./vitest.setup.ts"]
  }
})
