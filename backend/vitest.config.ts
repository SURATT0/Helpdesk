import { configDefaults, defineConfig } from "vitest/config";

// Default (unit) run: pure, DB-free tests. Integration tests are opt-in via
// vitest.integration.config.ts, so exclude them here.
export default defineConfig({
  test: {
    // Exclude integration tests (opt-in via their own config) and never collect
    // compiled test files from a stale `dist/` (CommonJS, breaks the collector).
    exclude: [...configDefaults.exclude, "**/dist/**", "**/*.integration.test.ts"],
  },
});
