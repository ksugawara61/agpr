import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const externalModules = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "commander",
  "execa",
];

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
      external: externalModules,
      output: {
        banner: "#!/usr/bin/env node",
      },
    },
    sourcemap: false,
  },
});
