import path from "path"
import { defineConfig } from "vitest/config"

/**
 * Separate from `vite.config.ts` on purpose: that one carries the dev proxy and
 * the Tailwind plugin, neither of which a unit test needs. Only the `@` alias
 * has to match.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    // Most of what's worth testing touches `window`, `localStorage` or the
    // document — the interview link, the stored session, tab visibility.
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    restoreMocks: true,
    unstubGlobals: true,
  },
})
