import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const repositoriesSourcePath = fileURLToPath(
  new URL("./packages/repositories/src", import.meta.url),
);

export default defineConfig({
  resolve: {
    alias: [
      {
        find: /^@agpr\/repositories\/(.+)$/,
        replacement: `${repositoriesSourcePath}/$1.ts`,
      },
      {
        find: "@agpr/repositories",
        replacement: `${repositoriesSourcePath}/index.ts`,
      },
    ],
  },
  test: {
    coverage: {
      exclude: ["**/*.test.ts"],
      include: ["apps/*/src/**/*.ts", "packages/*/src/**/*.ts"],
      provider: "v8",
      thresholds: {
        branches: 85,
        functions: 85,
        lines: 85,
        statements: 85,
      },
    },
    environment: "node",
    include: ["apps/*/src/**/*.test.ts", "packages/*/src/**/*.test.ts"],
  },
});
