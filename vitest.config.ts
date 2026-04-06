import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    globals: true,
    setupFiles: ["__tests__/setup/vitest.setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["services/**", "bot/**", "app/api/**", "lib/**"],
      exclude: ["lib/database.types.ts", "scripts/**"],
    },
    // Isolate each test file so module-level state (rate limiter store, etc.) resets
    isolate: true,
  },
});
