import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const externalModuleNames = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "@vitest/coverage-v8",
  "commander",
  "execa",
];

const isExternalModule = (id: string): boolean =>
  externalModuleNames.includes(id);

export default defineConfig({
  build: {
    emptyOutDir: true,
    lib: {
      entry: "src/cli.ts",
      fileName: () => "cli.js",
      formats: ["es"],
    },
    minify: "esbuild",
    rollupOptions: {
      external: isExternalModule,
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    sourcemap: false,
  },
  resolve: {
    conditions: ["node"],
  },
});
