import { builtinModules } from "node:module";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const repositoriesSourcePath = fileURLToPath(
  new URL("../../packages/repositories/src", import.meta.url),
);

const externalModuleNames = [
  ...builtinModules,
  ...builtinModules.map((moduleName) => `node:${moduleName}`),
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
    conditions: ["node"],
  },
});
