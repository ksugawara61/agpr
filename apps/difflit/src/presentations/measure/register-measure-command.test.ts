import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import { execa } from "execa";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { registerMeasureCommand } from "./register-measure-command.js";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

const mockExeca = vi.mocked(execa);

const createProgram = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  registerMeasureCommand(program);
  return program;
};

const makeExecaResult = (stdout = "") =>
  ({
    exitCode: 0,
    stdout,
  }) as Awaited<ReturnType<typeof execa>>;

type MockCommandValue =
  | Error
  | string
  | { exitCode?: number; stdout?: string }
  | undefined;

const toCommandKey = (file: string | URL, args?: readonly string[]): string =>
  [String(file), ...(args ?? [])].join(" ");

const toExecaResult = (value: Exclude<MockCommandValue, undefined>) => {
  if (value instanceof Error) {
    throw value;
  }
  if (typeof value === "string") {
    return makeExecaResult(value);
  }
  return { ...makeExecaResult(value.stdout), exitCode: value.exitCode ?? 0 };
};

const mockExecaCommands = (
  commands: Record<string, MockCommandValue>,
  fallback?: (file: string | URL, args?: readonly string[]) => MockCommandValue,
): void => {
  mockExeca.mockImplementation(async (file, args) => {
    const value = commands[toCommandKey(file, args)] ?? fallback?.(file, args);
    return value === undefined ? makeExecaResult() : toExecaResult(value);
  });
};

type CoverageFixtureOptions = {
  final?: boolean;
  key?: "absolute" | "relative";
  linePct?: 0 | 50 | 100;
  uncoveredLineCount?: number;
};

const writeCoverage = async (
  cwd: string,
  options: CoverageFixtureOptions = {},
): Promise<void> => {
  const sourcePath = resolve(cwd, "src/a.ts");
  const coverageKey = options.key === "relative" ? "src/a.ts" : sourcePath;
  const linePct = options.linePct ?? 50;
  const total = Math.max(2, (options.uncoveredLineCount ?? 1) + 1);
  const covered = linePct === 100 ? total : linePct === 0 ? 0 : total / 2;
  const uncoveredLineCount = options.uncoveredLineCount ?? total - covered;
  const statementCounts = Object.fromEntries(
    Array.from({ length: total }, (_, index) => [
      String(index),
      index < total - uncoveredLineCount ? 1 : 0,
    ]),
  );
  const statementMap = Object.fromEntries(
    Array.from({ length: total }, (_, index) => [
      String(index),
      { start: { line: index + 1 } },
    ]),
  );
  await mkdir(resolve(cwd, "coverage"), { recursive: true });
  await writeFile(
    resolve(cwd, "coverage/coverage-summary.json"),
    JSON.stringify({
      [coverageKey]: {
        branches: { covered: 0, pct: 0, total: 0 },
        functions: { covered: 1, pct: 100, total: 1 },
        lines: { covered, pct: linePct, total },
        statements: { covered, pct: linePct, total },
      },
      total: {
        branches: { covered: 0, pct: 0, total: 0 },
        functions: { covered: 1, pct: 100, total: 1 },
        lines: { covered, pct: linePct, total },
        statements: { covered, pct: linePct, total },
      },
    }),
    "utf-8",
  );
  if (options.final !== false) {
    await writeFile(
      resolve(cwd, "coverage/coverage-final.json"),
      JSON.stringify({
        [coverageKey]: {
          s: statementCounts,
          statementMap,
        },
      }),
      "utf-8",
    );
  }
};

const createProject = async (
  options: {
    coverage?: boolean;
    coverageOptions?: CoverageFixtureOptions;
    provider?: boolean;
  } = {},
): Promise<string> => {
  const cwd = await mkdtemp(join(tmpdir(), "difflit-"));
  if (options.provider !== false) {
    await mkdir(resolve(cwd, "node_modules/@vitest/coverage-v8"), {
      recursive: true,
    });
  }
  await mkdir(resolve(cwd, "src"), { recursive: true });
  await writeFile(resolve(cwd, "src/a.ts"), "export const a = 1;\n", "utf-8");
  if (options.coverage !== false) {
    await writeCoverage(cwd, options.coverageOptions);
  }
  return cwd;
};

const mockGitDiff = (cwd: string): void => {
  mockExecaCommands({
    "git diff basehash --name-only --diff-filter=ACM":
      "src/a.ts\nsrc/a.test.ts\nREADME.md\n",
    "git diff basehash --numstat --diff-filter=ACM":
      "2\t1\tsrc/a.ts\n1\t0\tsrc/a.test.ts\n",
    "git diff basehash --unified=0 -- src/a.ts":
      "@@ -0,0 +1,2 @@\n+export const a = 1;\n+export const b = 2;",
    "git merge-base HEAD main": "basehash",
    "git rev-parse --show-toplevel": cwd,
  });
};

let tmpDirs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  process.exitCode = undefined;
});

afterEach(async () => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
  await Promise.all(
    tmpDirs.map((dir) => rm(dir, { force: true, recursive: true })),
  );
  tmpDirs = [];
});

describe("registerMeasureCommand", () => {
  it("runs Vitest coverage for changed source files", async () => {
    const cwd = await createProject();
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd], {
      from: "user",
    });

    const vitestCall = mockExeca.mock.calls.find(
      ([file, args]) => file === "npx" && args?.includes("vitest"),
    );
    expect(vitestCall).toBeDefined();
    expect(vitestCall?.[1]).toEqual(
      expect.arrayContaining([
        "vitest",
        "related",
        "--coverage",
        "--coverage.enabled=true",
        "--coverage.provider=v8",
        "--coverage.reporter=json",
        "--coverage.reporter=json-summary",
        "--coverage.all=false",
        "--coverage.include",
        "src/a.ts",
        "--passWithNoTests",
      ]),
    );
    expect(logSpy.mock.calls[0]?.[0]).toContain(
      "=== Diff Coverage Report (vitest) ===",
    );
    expect(logSpy.mock.calls[0]?.[0]).toContain("src/a.ts");
    expect(errorSpy).toHaveBeenCalledWith("Running Vitest...\n");
  });

  it("prints changed files without running Vitest when diff-only is enabled", async () => {
    const cwd = await createProject();
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd, "--diff-only"], {
      from: "user",
    });

    expect(logSpy).toHaveBeenCalledWith(
      "Changed source files:\n- src/a.ts (+2/-1)",
    );
    expect(
      mockExeca.mock.calls.some(
        ([file, args]) => file === "npx" && args?.includes("vitest"),
      ),
    ).toBe(false);
  });

  it("prints raw JSON when json is enabled", async () => {
    const cwd = await createProject();
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd, "--json"], {
      from: "user",
    });

    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toMatchObject({
      files: [{ path: "src/a.ts" }],
      runner: "vitest",
      summary: { lines: { pct: 50 } },
    });
  });

  it("sets a failing exit code when coverage is below threshold", async () => {
    const cwd = await createProject();
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createProgram().parseAsync(
      ["measure", "--cwd", cwd, "--threshold", "80"],
      { from: "user" },
    );

    expect(logSpy.mock.calls[0]?.[0]).toContain("Threshold: 80% -> FAIL");
    expect(process.exitCode).toBe(1);
  });

  it("keeps a successful exit code when coverage meets threshold", async () => {
    const cwd = await createProject({
      coverageOptions: { linePct: 100, uncoveredLineCount: 0 },
    });
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createProgram().parseAsync(
      ["measure", "--cwd", cwd, "--threshold", "80"],
      { from: "user" },
    );

    expect(logSpy.mock.calls[0]?.[0]).toContain("Threshold: 80% -> PASS");
    expect(process.exitCode).toBeUndefined();
  });

  it("marks files with low line coverage as failed", async () => {
    const cwd = await createProject({
      coverageOptions: { linePct: 0, uncoveredLineCount: 2 },
    });
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd], {
      from: "user",
    });

    expect(logSpy.mock.calls[0]?.[0]).toContain("❌ src/a.ts");
  });

  it("prints a no-op message when no changed source files match", async () => {
    const cwd = await createProject();
    tmpDirs.push(cwd);
    mockExecaCommands({
      "git diff basehash --name-only --diff-filter=ACM":
        "src/a.test.ts\nREADME.md\n",
      "git merge-base HEAD main": "basehash",
      "git rev-parse --show-toplevel": cwd,
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd], {
      from: "user",
    });

    expect(logSpy).toHaveBeenCalledWith("No changed source files found.");
    expect(
      mockExeca.mock.calls.some(
        ([file, args]) => file === "npx" && args?.includes("vitest"),
      ),
    ).toBe(false);
  });

  it("uses custom base, command, include, and exclude options", async () => {
    const cwd = await createProject({
      coverageOptions: { key: "relative", linePct: 100, uncoveredLineCount: 0 },
    });
    tmpDirs.push(cwd);
    mockExecaCommands({
      "git diff origin/feature --name-only --diff-filter=ACM":
        "src/a.ts\nsrc/b.ts\n",
      "git diff origin/feature --numstat --diff-filter=ACM":
        "2\t1\tsrc/a.ts\n3\t0\tsrc/b.ts\n",
      "git diff origin/feature --unified=0 -- src/a.ts":
        "@@ -0,0 +1 @@\n+export const a = 1;",
      "git rev-parse --show-toplevel": cwd,
      "git rev-parse --verify origin/feature": "origin/feature",
    });
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createProgram().parseAsync(
      [
        "measure",
        "--cwd",
        cwd,
        "--base",
        "feature",
        "--cmd",
        "pnpm vitest run",
        "--include",
        "src/**",
        "--exclude",
        "src/b.ts",
      ],
      { from: "user" },
    );

    const vitestCall = mockExeca.mock.calls.find(
      ([file, args]) => file === "pnpm" && args?.includes("vitest"),
    );
    expect(vitestCall?.[1]).toEqual(
      expect.arrayContaining([
        "vitest",
        "run",
        "--coverage.include",
        "src/a.ts",
      ]),
    );
    expect(vitestCall?.[1]).not.toContain("src/b.ts");
    expect(logSpy.mock.calls[0]?.[0]).toContain("✅ src/a.ts");
  });

  it("falls back to origin/main when local main is unavailable", async () => {
    const cwd = await createProject();
    tmpDirs.push(cwd);
    mockExecaCommands({
      "git diff originbase --name-only --diff-filter=ACM": "src/a.ts\n",
      "git diff originbase --numstat --diff-filter=ACM": "2\t1\tsrc/a.ts\n",
      "git diff originbase --unified=0 -- src/a.ts":
        "@@ -0,0 +1 @@\n+export const a = 1;",
      "git merge-base HEAD main": new Error("main not found"),
      "git merge-base HEAD origin/main": "originbase",
      "git rev-parse --show-toplevel": cwd,
    });
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd], {
      from: "user",
    });

    expect(mockExeca).toHaveBeenCalledWith(
      "git",
      ["merge-base", "HEAD", "origin/main"],
      { cwd },
    );
  });

  it("uses the bundled coverage provider when the project has none", async () => {
    const cwd = await createProject({ provider: false });
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd], {
      from: "user",
    });

    const vitestCall = mockExeca.mock.calls.find(
      ([file, args]) => file === "npx" && args?.includes("vitest"),
    );
    expect(vitestCall?.[1]).toContain("--coverage.provider=v8");
  });

  it("sets a failing exit code when Vitest fails", async () => {
    const cwd = await createProject();
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const gitMock = mockExeca.getMockImplementation();
    mockExeca.mockImplementation(async (file, args, options) => {
      if (file === "npx" && args?.includes("vitest")) {
        return { ...makeExecaResult(), exitCode: 1 };
      }
      return gitMock?.(file, args, options) ?? makeExecaResult();
    });
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd], {
      from: "user",
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "Error:",
      "Vitest exited with code 1.",
    );
    expect(process.exitCode).toBe(1);
  });

  it("sets a failing exit code when coverage output is missing", async () => {
    const cwd = await createProject({ coverage: false });
    tmpDirs.push(cwd);
    mockGitDiff(cwd);
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);

    await createProgram().parseAsync(["measure", "--cwd", cwd], {
      from: "user",
    });

    expect(errorSpy).toHaveBeenCalledWith(
      "Error:",
      "Failed to read coverage report. Check the Vitest output above.",
    );
    expect(process.exitCode).toBe(1);
  });

  it("rejects an invalid threshold", async () => {
    await expect(
      createProgram().parseAsync(["measure", "--threshold", "abc"], {
        from: "user",
      }),
    ).rejects.toMatchObject({
      code: "commander.invalidArgument",
    });
  });
});
