import { createDenoDependencies, removeWorktree } from "./lib.ts";

if (import.meta.main) {
  const exitCode = await removeWorktree(Deno.args, createDenoDependencies());
  Deno.exit(exitCode);
}
