import { builtinModules } from "node:module";
import { defineConfig } from "vite";

const externalModuleNames = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
  "commander",
];

const isExternalModule = (id: string): boolean =>
  externalModuleNames.includes(id) ||
  id === "@ksugawara61/agpr-repositories" ||
  id.startsWith("@ksugawara61/agpr-repositories/");

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
});
