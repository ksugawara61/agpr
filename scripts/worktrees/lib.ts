const supportedTools = ["codex", "copilot"] as const;

export type WorktreeTool = (typeof supportedTools)[number];

type CommandStream = "inherit" | "null" | "piped";

export type CommandOptions = {
  cwd?: string;
  stderr?: CommandStream;
  stdin?: CommandStream;
  stdout?: CommandStream;
};

export type CommandResult = {
  code: number;
  stderr: string;
  stdout: string;
};

type CommandRunner = (
  command: string,
  args: string[],
  options?: CommandOptions,
) => Promise<CommandResult>;

export type WorktreeDependencies = {
  getCwd: () => string;
  runCommand: CommandRunner;
  stderr: (message: string) => void;
  stdout: (message: string) => void;
};

export type IncludeCopyResult = {
  copied: string[];
  skippedMissing: string[];
  skippedUnsafe: string[];
};

type ToolParseResult =
  | {
      status: number;
      type: "exit";
    }
  | {
      tool: WorktreeTool;
      type: "tool";
    };

type GitWorktreeInfo = {
  gitCommonDir: string;
  gitDir: string;
  worktreeRoot: string;
};

const createUsage = `Usage: scripts/worktrees/create.ts <codex|copilot> <name> [tool-args...]

Creates a git worktree at .worktrees/<tool>/<name>, copies paths
listed in .worktreeinclude, installs dependencies, starts the selected tool,
and removes the worktree after the tool exits.`;

const removeUsage = `Usage: scripts/worktrees/remove.ts <codex|copilot>

Removes the current linked worktree when it lives under
.worktrees/<tool>/<name>, then moves back to the project root.`;

const textDecoder = new TextDecoder();

export function createDenoDependencies(): WorktreeDependencies {
  return {
    getCwd: () => Deno.cwd(),
    runCommand: async (command, args, options = {}) => {
      const stderr = options.stderr ?? "piped";
      const stdin = options.stdin ?? "null";
      const stdout = options.stdout ?? "piped";
      const output = await new Deno.Command(command, {
        args,
        cwd: options.cwd,
        stderr,
        stdin,
        stdout,
      }).output();

      return {
        code: output.code,
        stderr: stderr === "piped" ? textDecoder.decode(output.stderr) : "",
        stdout: stdout === "piped" ? textDecoder.decode(output.stdout) : "",
      };
    },
    stderr: (message) => {
      console.error(message);
    },
    stdout: (message) => {
      console.log(message);
    },
  };
}

export async function createWorktree(
  args: string[],
  dependencies: WorktreeDependencies,
): Promise<number> {
  if (args.length === 0) {
    dependencies.stderr(createUsage);
    return 1;
  }

  if (isHelpArgument(args[0])) {
    dependencies.stdout(createUsage);
    return 0;
  }

  if (args.length < 2) {
    dependencies.stderr(createUsage);
    return 1;
  }

  const [toolArgument, worktreeName, ...toolArgs] = args;
  const tool = parseTool(toolArgument);
  if (tool == null) {
    writeInvalidTool(dependencies, toolArgument);
    return 1;
  }

  const repoRootResult = await runForStdout(dependencies, "git", [
    "rev-parse",
    "--show-toplevel",
  ]);
  if (!repoRootResult.ok) {
    return 1;
  }

  const repoRoot = repoRootResult.stdout.trim();
  const branchName = `${tool}/${worktreeName}`;
  const worktreeDir = joinPath(repoRoot, ".worktrees", tool, worktreeName);
  const includeFile = joinPath(repoRoot, ".worktreeinclude");

  const refResult = await dependencies.runCommand("git", [
    "check-ref-format",
    "--branch",
    branchName,
  ]);
  if (refResult.code !== 0) {
    dependencies.stderr(`Invalid branch name: ${branchName}`);
    writeCommandOutput(dependencies, refResult);
    return 1;
  }

  if (await pathExists(worktreeDir)) {
    dependencies.stderr(`Worktree path already exists: ${worktreeDir}`);
    return 1;
  }

  await Deno.mkdir(dirname(worktreeDir), { recursive: true });

  const addStatus = await runForwarding(dependencies, "git", [
    "-C",
    repoRoot,
    "worktree",
    "add",
    "-b",
    branchName,
    worktreeDir,
  ]);
  if (addStatus !== 0) {
    return addStatus;
  }

  await copyIncludedPaths({
    includeFile,
    logger: dependencies,
    repoRoot,
    worktreeDir,
  });

  const installStatus = await runForwarding(dependencies, "pnpm", ["install"], {
    cwd: worktreeDir,
  });
  if (installStatus !== 0) {
    return installStatus;
  }

  const toolStatus = await runTool(tool, worktreeDir, toolArgs, dependencies);
  const removeStatus = await removeWorktree([tool], {
    ...dependencies,
    getCwd: () => worktreeDir,
  });

  return toolStatus === 0 ? removeStatus : toolStatus;
}

export async function removeWorktree(
  args: string[],
  dependencies: WorktreeDependencies,
): Promise<number> {
  const parseResult = parseRemoveTool(args, dependencies);
  if (parseResult.type === "exit") {
    return parseResult.status;
  }

  const tool = parseResult.tool;
  const worktreeInfo = await readGitWorktreeInfo(dependencies);
  if (worktreeInfo == null) {
    return 1;
  }

  if (worktreeInfo.gitDir === worktreeInfo.gitCommonDir) {
    dependencies.stderr(
      "Not in a linked worktree. Refusing to remove the main worktree.",
    );
    return 1;
  }

  const projectRoot = inferProjectRoot(worktreeInfo.worktreeRoot, tool);
  if (projectRoot == null) {
    dependencies.stderr(
      `Current linked worktree is not under a .worktrees/${tool} directory.`,
    );
    dependencies.stderr(`Current worktree: ${worktreeInfo.worktreeRoot}`);
    return 1;
  }

  const removeStatus = await runForwarding(dependencies, "git", [
    "-C",
    projectRoot,
    "worktree",
    "remove",
    worktreeInfo.worktreeRoot,
  ]);
  if (removeStatus !== 0) {
    return removeStatus;
  }

  if (await pathExists(worktreeInfo.worktreeRoot)) {
    try {
      await Deno.remove(worktreeInfo.worktreeRoot);
    } catch {
      dependencies.stderr(
        `Worktree directory still exists and is not empty: ${worktreeInfo.worktreeRoot}`,
      );
      return 1;
    }
  }

  dependencies.stdout(`Removed worktree: ${worktreeInfo.worktreeRoot}`);
  dependencies.stdout(`Project root: ${projectRoot}`);
  return 0;
}

export async function copyIncludedPaths({
  includeFile,
  logger,
  repoRoot,
  worktreeDir,
}: {
  includeFile: string;
  logger: Pick<WorktreeDependencies, "stderr">;
  repoRoot: string;
  worktreeDir: string;
}): Promise<IncludeCopyResult> {
  if (!(await pathExists(includeFile))) {
    return { copied: [], skippedMissing: [], skippedUnsafe: [] };
  }

  const content = await Deno.readTextFile(includeFile);
  const includePaths = content
    .split("\n")
    .map(normalizeIncludeLine)
    .filter((includePath) => includePath != null);
  const initialResult: IncludeCopyResult = {
    copied: [],
    skippedMissing: [],
    skippedUnsafe: [],
  };

  return includePaths.reduce<Promise<IncludeCopyResult>>(
    async (resultPromise, includePath) => {
      const result = await resultPromise;
      if (!isSafeRelativePath(includePath)) {
        logger.stderr(`Skipping unsafe .worktreeinclude path: ${includePath}`);
        return {
          ...result,
          skippedUnsafe: [...result.skippedUnsafe, includePath],
        };
      }

      const sourcePath = joinPath(repoRoot, includePath);
      const targetPath = joinPath(worktreeDir, includePath);
      if (!(await pathExists(sourcePath))) {
        logger.stderr(`Skipping missing .worktreeinclude path: ${includePath}`);
        return {
          ...result,
          skippedMissing: [...result.skippedMissing, includePath],
        };
      }

      await copyPath(sourcePath, targetPath);
      return { ...result, copied: [...result.copied, includePath] };
    },
    Promise.resolve(initialResult),
  );
}

export function inferProjectRoot(
  worktreeRoot: string,
  tool: WorktreeTool,
): string | null {
  const marker = `/.worktrees/${tool}/`;
  const markerIndex = worktreeRoot.lastIndexOf(marker);
  if (markerIndex === -1) {
    return null;
  }

  const projectRoot = worktreeRoot.slice(0, markerIndex);
  const worktreeName = worktreeRoot.slice(markerIndex + marker.length);
  if (projectRoot === "" || worktreeName === "") {
    return null;
  }

  return projectRoot;
}

export function joinPath(firstSegment: string, ...otherSegments: string[]) {
  const first = stripTrailingSlashes(firstSegment);
  const rest = otherSegments
    .map((segment) => segment.replace(/^\/+|\/+$/g, ""))
    .filter((segment) => segment !== "");

  if (first === "") {
    return rest.join("/");
  }

  if (first === "/") {
    return `/${rest.join("/")}`;
  }

  return [first, ...rest].join("/");
}

function parseTool(tool: string): WorktreeTool | null {
  return supportedTools.find((supportedTool) => supportedTool === tool) ?? null;
}

function parseRemoveTool(
  args: string[],
  dependencies: WorktreeDependencies,
): ToolParseResult {
  if (args.length === 0) {
    dependencies.stderr(removeUsage);
    return { status: 1, type: "exit" };
  }

  if (isHelpArgument(args[0])) {
    dependencies.stdout(removeUsage);
    return { status: 0, type: "exit" };
  }

  if (args.length !== 1) {
    dependencies.stderr(removeUsage);
    return { status: 1, type: "exit" };
  }

  const tool = parseTool(args[0]);
  if (tool == null) {
    writeInvalidTool(dependencies, args[0]);
    return { status: 1, type: "exit" };
  }

  return { tool, type: "tool" };
}

async function readGitWorktreeInfo(
  dependencies: WorktreeDependencies,
): Promise<GitWorktreeInfo | null> {
  const cwd = dependencies.getCwd();
  const [worktreeRootResult, gitDirResult, gitCommonDirResult] =
    await Promise.all([
      runForStdout(dependencies, "git", ["rev-parse", "--show-toplevel"], {
        cwd,
      }),
      runForStdout(
        dependencies,
        "git",
        ["rev-parse", "--path-format=absolute", "--git-dir"],
        { cwd },
      ),
      runForStdout(
        dependencies,
        "git",
        ["rev-parse", "--path-format=absolute", "--git-common-dir"],
        { cwd },
      ),
    ]);

  if (!worktreeRootResult.ok || !gitDirResult.ok || !gitCommonDirResult.ok) {
    return null;
  }

  return {
    gitCommonDir: await Deno.realPath(gitCommonDirResult.stdout.trim()),
    gitDir: await Deno.realPath(gitDirResult.stdout.trim()),
    worktreeRoot: await Deno.realPath(worktreeRootResult.stdout.trim()),
  };
}

function isHelpArgument(argument: string): boolean {
  return argument === "-h" || argument === "--help";
}

function writeInvalidTool(
  dependencies: Pick<WorktreeDependencies, "stderr">,
  tool: string,
): void {
  dependencies.stderr(`Unsupported tool: ${tool}`);
  dependencies.stderr("Expected one of: codex, copilot");
}

async function runForStdout(
  dependencies: WorktreeDependencies,
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<{ ok: true; stdout: string } | { ok: false }> {
  const result = await dependencies.runCommand(command, args, options);
  if (result.code === 0) {
    return { ok: true, stdout: result.stdout };
  }

  dependencies.stderr(
    `Command failed (${result.code}): ${formatCommand(command, args)}`,
  );
  writeCommandOutput(dependencies, result);
  return { ok: false };
}

async function runForwarding(
  dependencies: WorktreeDependencies,
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<number> {
  const result = await dependencies.runCommand(command, args, {
    ...options,
    stderr: "inherit",
    stdout: "inherit",
  });
  if (result.code === 0) {
    return 0;
  }

  dependencies.stderr(
    `Command failed (${result.code}): ${formatCommand(command, args)}`,
  );
  writeCommandOutput(dependencies, result);
  return result.code;
}

async function runTool(
  tool: WorktreeTool,
  worktreeDir: string,
  toolArgs: string[],
  dependencies: WorktreeDependencies,
): Promise<number> {
  const commandArgs =
    tool === "codex"
      ? ["--sandbox", "workspace-write", "--add-dir", worktreeDir, ...toolArgs]
      : ["--add-dir", worktreeDir, ...toolArgs];
  const result = await dependencies.runCommand(tool, commandArgs, {
    cwd: worktreeDir,
    stderr: "inherit",
    stdin: "inherit",
    stdout: "inherit",
  });

  return result.code;
}

function writeCommandOutput(
  dependencies: Pick<WorktreeDependencies, "stderr">,
  result: CommandResult,
): void {
  const stderr = result.stderr.trim();
  const stdout = result.stdout.trim();
  if (stderr !== "") {
    dependencies.stderr(stderr);
    return;
  }

  if (stdout !== "") {
    dependencies.stderr(stdout);
  }
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].join(" ");
}

function normalizeIncludeLine(line: string): string | null {
  const withoutCarriageReturn = line.endsWith("\r") ? line.slice(0, -1) : line;
  const trimmed = withoutCarriageReturn.trim();
  if (trimmed === "" || trimmed.startsWith("#")) {
    return null;
  }

  return trimmed;
}

function isSafeRelativePath(path: string): boolean {
  if (path.startsWith("/") || path.includes("\0")) {
    return false;
  }

  const segments = path
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".");
  return segments.length > 0 && !segments.some((segment) => segment === "..");
}

async function copyPath(sourcePath: string, targetPath: string): Promise<void> {
  const sourceInfo = await Deno.lstat(sourcePath);
  await Deno.mkdir(dirname(targetPath), { recursive: true });

  if (sourceInfo.isSymlink) {
    await copySymlink(sourcePath, targetPath);
    return;
  }

  if (sourceInfo.isDirectory) {
    await copyDirectory(sourcePath, targetPath);
    return;
  }

  await Deno.copyFile(sourcePath, targetPath);
  await preserveMode(targetPath, sourceInfo.mode);
}

async function copySymlink(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  if (await pathExists(targetPath)) {
    await Deno.remove(targetPath, { recursive: true });
  }

  const linkTarget = await Deno.readLink(sourcePath);
  await Deno.symlink(linkTarget, targetPath);
}

async function copyDirectory(
  sourcePath: string,
  targetPath: string,
): Promise<void> {
  await Deno.mkdir(targetPath, { recursive: true });
  const entries = [];
  for await (const entry of Deno.readDir(sourcePath)) {
    entries.push(entry.name);
  }

  for (const entryName of entries) {
    await copyPath(
      joinPath(sourcePath, entryName),
      joinPath(targetPath, entryName),
    );
  }
}

async function preserveMode(path: string, mode: number | null): Promise<void> {
  if (mode == null) {
    return;
  }

  try {
    await Deno.chmod(path, mode & 0o777);
  } catch {
    // Some filesystems do not support chmod. The copy itself is still useful.
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await Deno.lstat(path);
    return true;
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) {
      return false;
    }

    throw error;
  }
}

function dirname(path: string): string {
  const stripped = stripTrailingSlashes(path);
  const lastSlashIndex = stripped.lastIndexOf("/");
  if (lastSlashIndex === -1) {
    return ".";
  }

  if (lastSlashIndex === 0) {
    return "/";
  }

  return stripped.slice(0, lastSlashIndex);
}

function stripTrailingSlashes(path: string): string {
  if (path === "/") {
    return path;
  }

  return path.replace(/\/+$/g, "");
}
