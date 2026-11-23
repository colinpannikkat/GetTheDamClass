import { defineConfig } from "vitest/config"
import { WxtVitest } from "wxt/testing/vitest-plugin"

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    setupFiles: ["./vitest.setup.ts"]
  }
})
