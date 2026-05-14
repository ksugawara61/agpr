import {
  type CommandOptions,
  type CommandResult,
  copyIncludedPaths,
  createWorktree,
  inferProjectRoot,
  joinPath,
  removeWorktree,
  type WorktreeDependencies,
} from "./lib.ts";

type CommandCall = {
  args: string[];
  command: string;
  options: CommandOptions;
};

type FakeCommandHandler = (
  call: CommandCall,
) => CommandResult | Promise<CommandResult>;

type CommandResponse = (
  call: CommandCall,
) => CommandResult | Promise<CommandResult>;

function ok(stdout = ""): CommandResult {
  return { code: 0, stderr: "", stdout };
}

function failed(code: number, stderr = ""): CommandResult {
  return { code, stderr, stdout: "" };
}

function createFakeDependencies({
  cwd,
  handler = () => ok(),
}: {
  cwd: string;
  handler?: FakeCommandHandler;
}): WorktreeDependencies & {
  calls: CommandCall[];
  stderrMessages: string[];
  stdoutMessages: string[];
} {
  const calls: CommandCall[] = [];
  const stderrMessages: string[] = [];
  const stdoutMessages: string[] = [];

  return {
    calls,
    getCwd: () => cwd,
    runCommand: async (command, args, options = {}) => {
      const call = { args, command, options };
      calls.push(call);
      return await handler(call);
    },
    stderr: (message) => {
      stderrMessages.push(message);
    },
    stderrMessages,
    stdout: (message) => {
      stdoutMessages.push(message);
    },
    stdoutMessages,
  };
}

async function withTempDir(
  test: (tempDir: string) => Promise<void>,
): Promise<void> {
  const tempDir = await Deno.makeTempDir({ prefix: "worktrees-test-" });
  try {
    await test(tempDir);
  } finally {
    await Deno.remove(tempDir, { recursive: true });
  }
}

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function assertEquals<T>(actual: T, expected: T): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`Expected ${expectedJson}, got ${actualJson}`);
  }
}

function assertIncludes(value: string, expected: string): void {
  if (!value.includes(expected)) {
    throw new Error(`Expected "${value}" to include "${expected}"`);
  }
}

function sortStrings(values: string[]): string[] {
  return [...values].sort();
}

function commandKey({ args, command }: CommandCall): string {
  if (command !== "git") {
    return command;
  }

  if (args.includes("--show-toplevel")) {
    return "git:show-toplevel";
  }

  if (args.includes("--git-dir")) {
    return "git:git-dir";
  }

  if (args.includes("--git-common-dir")) {
    return "git:git-common-dir";
  }

  if (args.includes("check-ref-format")) {
    return "git:check-ref-format";
  }

  if (args.includes("add")) {
    return "git:worktree-add";
  }

  if (args.includes("remove")) {
    return "git:worktree-remove";
  }

  return "git:unknown";
}

function createLifecycleHandler({
  gitCommonDir,
  gitDir,
  repoRoot,
  worktreeDir,
}: {
  gitCommonDir: string;
  gitDir: string;
  repoRoot: string;
  worktreeDir: string;
}): FakeCommandHandler {
  const responses = new Map<string, CommandResponse>([
    [
      "git:show-toplevel",
      ({ options }) =>
        ok(`${options.cwd === worktreeDir ? worktreeDir : repoRoot}\n`),
    ],
    ["git:git-dir", () => ok(`${gitDir}\n`)],
    ["git:git-common-dir", () => ok(`${gitCommonDir}\n`)],
    ["git:check-ref-format", () => ok()],
    [
      "git:worktree-add",
      async () => {
        await Deno.mkdir(worktreeDir, { recursive: true });
        await Deno.mkdir(gitDir, { recursive: true });
        return ok();
      },
    ],
    ["pnpm", () => ok()],
    ["codex", () => failed(42, "tool failed")],
    [
      "git:worktree-remove",
      async () => {
        await Deno.remove(worktreeDir, { recursive: true });
        return ok();
      },
    ],
  ]);

  return async (call) => {
    const response = responses.get(commandKey(call));
    return response == null
      ? failed(99, `unexpected command: ${call.command} ${call.args.join(" ")}`)
      : await response(call);
  };
}

Deno.test("createWorktree prints usage for help", async () => {
  const dependencies = createFakeDependencies({ cwd: "/" });
  const status = await createWorktree(["--help"], dependencies);

  assertEquals(status, 0);
  assertIncludes(dependencies.stdoutMessages.join("\n"), "Usage:");
  assertEquals(dependencies.calls, []);
});

Deno.test("createWorktree rejects unsupported tools", async () => {
  const dependencies = createFakeDependencies({ cwd: "/" });
  const status = await createWorktree(["cursor", "feature"], dependencies);

  assertEquals(status, 1);
  assertIncludes(
    dependencies.stderrMessages.join("\n"),
    "Unsupported tool: cursor",
  );
  assertEquals(dependencies.calls, []);
});

Deno.test("copyIncludedPaths copies files, directories, and symlinks", async () => {
  await withTempDir(async (tempDir) => {
    const repoRoot = joinPath(tempDir, "repo");
    const worktreeDir = joinPath(tempDir, "worktree");
    const includeFile = joinPath(repoRoot, ".worktreeinclude");
    const stderrMessages: string[] = [];
    await Deno.mkdir(joinPath(repoRoot, ".claude"), { recursive: true });
    await Deno.mkdir(joinPath(repoRoot, "config", "dir"), {
      recursive: true,
    });
    await Deno.mkdir(worktreeDir, { recursive: true });
    await Deno.writeTextFile(
      joinPath(repoRoot, ".claude", "settings.local.json"),
      '{"ok":true}',
    );
    await Deno.writeTextFile(
      joinPath(repoRoot, "config", "dir", "value.txt"),
      "nested",
    );
    await Deno.symlink(
      "settings.local.json",
      joinPath(repoRoot, ".claude", "settings-link"),
    );
    await Deno.writeTextFile(
      includeFile,
      [
        "# comment",
        ".claude/settings.local.json\r",
        "config/dir",
        ".claude/settings-link",
        "missing",
        "../escape",
        "",
      ].join("\n"),
    );

    const result = await copyIncludedPaths({
      includeFile,
      logger: {
        stderr: (message) => {
          stderrMessages.push(message);
        },
      },
      repoRoot,
      worktreeDir,
    });

    assertEquals(sortStrings(result.copied), [
      ".claude/settings-link",
      ".claude/settings.local.json",
      "config/dir",
    ]);
    assertEquals(result.skippedMissing, ["missing"]);
    assertEquals(result.skippedUnsafe, ["../escape"]);
    assertEquals(
      await Deno.readTextFile(
        joinPath(worktreeDir, ".claude", "settings.local.json"),
      ),
      '{"ok":true}',
    );
    assertEquals(
      await Deno.readTextFile(
        joinPath(worktreeDir, "config", "dir", "value.txt"),
      ),
      "nested",
    );
    assertEquals(
      await Deno.readLink(joinPath(worktreeDir, ".claude", "settings-link")),
      "settings.local.json",
    );
    assertIncludes(
      stderrMessages.join("\n"),
      "Skipping missing .worktreeinclude path: missing",
    );
    assertIncludes(
      stderrMessages.join("\n"),
      "Skipping unsafe .worktreeinclude path: ../escape",
    );
  });
});

Deno.test("removeWorktree refuses to remove the main worktree", async () => {
  await withTempDir(async (projectRoot) => {
    const gitDir = joinPath(projectRoot, ".git");
    await Deno.mkdir(gitDir, { recursive: true });
    const dependencies = createFakeDependencies({
      cwd: projectRoot,
      handler: ({ args }) => {
        if (args.includes("--show-toplevel")) {
          return ok(`${projectRoot}\n`);
        }

        if (args.includes("--git-dir") || args.includes("--git-common-dir")) {
          return ok(`${gitDir}\n`);
        }

        return failed(99, "unexpected command");
      },
    });

    const status = await removeWorktree(["codex"], dependencies);

    assertEquals(status, 1);
    assertIncludes(
      dependencies.stderrMessages.join("\n"),
      "Refusing to remove the main worktree",
    );
  });
});

Deno.test("removeWorktree refuses linked worktrees outside the expected tool directory", async () => {
  await withTempDir(async (tempDir) => {
    const projectRoot = joinPath(tempDir, "repo");
    const worktreeRoot = joinPath(tempDir, "other-worktree");
    const gitDir = joinPath(projectRoot, ".git", "worktrees", "other");
    const gitCommonDir = joinPath(projectRoot, ".git");
    await Deno.mkdir(worktreeRoot, { recursive: true });
    await Deno.mkdir(gitDir, { recursive: true });
    await Deno.mkdir(gitCommonDir, { recursive: true });
    const dependencies = createFakeDependencies({
      cwd: worktreeRoot,
      handler: ({ args }) => {
        if (args.includes("--show-toplevel")) {
          return ok(`${worktreeRoot}\n`);
        }

        if (args.includes("--git-dir")) {
          return ok(`${gitDir}\n`);
        }

        if (args.includes("--git-common-dir")) {
          return ok(`${gitCommonDir}\n`);
        }

        return failed(99, "unexpected command");
      },
    });

    const status = await removeWorktree(["codex"], dependencies);

    assertEquals(status, 1);
    assertIncludes(
      dependencies.stderrMessages.join("\n"),
      "is not under a .worktrees/codex directory",
    );
  });
});

Deno.test("createWorktree cleans up after tool failure and preserves tool status", async () => {
  await withTempDir(async (repoRoot) => {
    const worktreeDir = joinPath(repoRoot, ".worktrees", "codex", "feature");
    const gitCommonDir = joinPath(repoRoot, ".git");
    const gitDir = joinPath(gitCommonDir, "worktrees", "feature");
    await Deno.mkdir(gitCommonDir, { recursive: true });

    const dependencies = createFakeDependencies({
      cwd: repoRoot,
      handler: createLifecycleHandler({
        gitCommonDir,
        gitDir,
        repoRoot,
        worktreeDir,
      }),
    });

    const status = await createWorktree(
      ["codex", "feature", "--model", "gpt"],
      dependencies,
    );
    const toolCallIndex = dependencies.calls.findIndex(
      (call) => call.command === "codex",
    );
    const removeCallIndex = dependencies.calls.findIndex(
      (call) => call.command === "git" && call.args.includes("remove"),
    );

    assertEquals(status, 42);
    assert(toolCallIndex >= 0, "expected codex to run");
    assert(removeCallIndex > toolCallIndex, "expected cleanup after codex");
    assertEquals(dependencies.calls[toolCallIndex]?.args, [
      "--sandbox",
      "workspace-write",
      "--add-dir",
      worktreeDir,
      "--model",
      "gpt",
    ]);
  });
});

Deno.test("inferProjectRoot returns the project root for managed worktrees", () => {
  assertEquals(
    inferProjectRoot("/repo/.worktrees/copilot/feature", "copilot"),
    "/repo",
  );
  assertEquals(inferProjectRoot("/repo/worktree", "copilot"), null);
});
