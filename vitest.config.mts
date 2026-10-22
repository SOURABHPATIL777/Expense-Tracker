import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@": root("./src"),
      // `server-only` throws outside a React Server environment; tests run plain Node.
      "server-only": root("./tests/stubs/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/unit/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
  },
});
