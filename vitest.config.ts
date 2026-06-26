import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 20000,
    // beforeAll hooks provision up to ~7 auth users each; the default 10s
    // hookTimeout is too tight when the local Auth server is cold/slow.
    hookTimeout: 40000,
    fileParallelism: false, // RLS tests share one local DB
    server: {
      deps: {
        inline: ["server-only"],
      },
    },
  },
  resolve: {
    alias: {
      "server-only": new URL("./tests/setup/server-only-shim.ts", import.meta.url).pathname,
    },
  },
});
