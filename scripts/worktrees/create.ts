import { createDenoDependencies, createWorktree } from "./lib.ts";

if (import.meta.main) {
  const exitCode = await createWorktree(Deno.args, createDenoDependencies());
  Deno.exit(exitCode);
}
