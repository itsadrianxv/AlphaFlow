import { defineConfig } from "vitest/config";
import path from "path";

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
      "web/**/*.test.ts",
      "web/**/*.spec.ts",
      "web/**/*.property.test.ts",
    ],
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      include: ["app/**/*.ts", "web/**/*.ts"],
      exclude: [
        "app/**/*.test.ts",
        "app/**/*.spec.ts",
        "app/**/*.property.test.ts",
        "app/**/__tests__/**",
        "web/**/*.test.ts",
        "web/**/*.spec.ts",
        "web/**/*.property.test.ts",
        "web/**/__tests__/**",
      ],
    },
  },
  resolve: {
    alias: {
      "~/app": path.resolve(__dirname, "../app"),
      "~": path.resolve(__dirname, "../web"),
    },
  },
});
