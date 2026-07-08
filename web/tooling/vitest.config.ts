import path from "node:path";
import { defineConfig } from "vitest/config";

// Tests import server modules that validate runtime env eagerly.
process.env.SKIP_ENV_VALIDATION = process.env.SKIP_ENV_VALIDATION ?? "1";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: [
      "app/**/*.test.ts",
      "app/**/*.spec.ts",
      "app/**/*.property.test.ts",
      "contracts/**/*.test.ts",
      "contracts/**/*.spec.ts",
      "contracts/**/*.property.test.ts",
      "server/**/*.test.ts",
      "server/**/*.spec.ts",
      "server/**/*.property.test.ts",
      "tests/**/*.test.ts",
      "tests/**/*.spec.ts",
      "trpc/**/*.test.ts",
      "trpc/**/*.spec.ts",
      "trpc/**/*.property.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: [
        "app/**/*.ts",
        "contracts/**/*.ts",
        "server/**/*.ts",
        "trpc/**/*.ts",
      ],
      exclude: [
        "app/**/*.test.ts",
        "app/**/*.spec.ts",
        "app/**/*.property.test.ts",
        "app/**/__tests__/**",
        "contracts/**/*.test.ts",
        "contracts/**/*.spec.ts",
        "contracts/**/*.property.test.ts",
        "contracts/**/__tests__/**",
        "server/**/*.test.ts",
        "server/**/*.spec.ts",
        "server/**/*.property.test.ts",
        "server/**/__tests__/**",
        "trpc/**/*.test.ts",
        "trpc/**/*.spec.ts",
        "trpc/**/*.property.test.ts",
        "trpc/**/__tests__/**",
      ],
    },
  },
  resolve: {
    alias: {
      "~/app": path.resolve(__dirname, "../app"),
      "~": path.resolve(__dirname, ".."),
    },
  },
});
