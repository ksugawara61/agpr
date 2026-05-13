import {
  access,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, extname, join, relative, resolve } from "node:path";
import { type Command, InvalidArgumentError } from "commander";
import { execa } from "execa";

type CoverageMetric = { covered: number; pct: number; total: number };

type CoverageSummaryEntry = {
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
  statements: CoverageMetric;
};

type CoverageSummary = Record<string, CoverageSummaryEntry>;

type StatementLocation = { start?: { line?: number } };

type FileDetail = {
  s?: Record<string, number>;
  statementMap?: Record<string, StatementLocation>;
};

type DiffFile = {
  addedLines: number[];
  additions: number;
  deletions: number;
  path: string;
  repoPath: string;
};

type FileCoverage = {
  branches: CoverageMetric;
  functions: CoverageMetric;
  lines: CoverageMetric;
  path: string;
  statements: CoverageMetric;
  uncoveredLines: number[];
};

type DiffCoverageResult = {
  files: FileCoverage[];
  runner: "vitest";
  summary: {
    branches: CoverageMetric;
    coveredFiles: number;
    functions: CoverageMetric;
    lines: CoverageMetric;
    statements: CoverageMetric;
    totalFiles: number;
  };
  timestamp: string;
  uncoveredFiles: string[];
};

type MeasureCommandOptions = {
  base?: string;
  cmd?: string;
  cwd: string;
  diffOnly?: boolean;
  exclude?: string;
  ext: string;
  include?: string;
  json?: boolean;
  threshold?: number;
};

type CoverageProvider = "v8" | "istanbul";

type Totals = {
  branchCovered: number;
  branchTotal: number;
  fnCovered: number;
  fnTotal: number;
  lineCovered: number;
  lineTotal: number;
  stmtCovered: number;
  stmtTotal: number;
};

const DEFAULT_EXCLUDE_PATTERNS = [
  /\.test\./,
  /\.spec\./,
  /(^|\/)__tests__(\/|$)/,
  /\.d\.ts$/,
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /(^|\/)coverage\//,
];

const require = createRequire(import.meta.url);

const normalizePath = (path: string): string => path.split("\\").join("/");

const parseCsv = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

const globToRegex = (glob: string): RegExp => {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\?/g, "[^/]")
    .split("**/")
    .map((segment) => segment.split("**").join(".*").split("*").join("[^/]*"))
    .join("(.*/)?");
  return new RegExp(
    glob.includes("/") ? `^${escaped}($|/)` : `(^|/)${escaped}$`,
  );
};

const parseThreshold = (value: string): number => {
  const threshold = Number.parseFloat(value);
  if (!Number.isFinite(threshold)) {
    throw new InvalidArgumentError("threshold must be a number");
  }
  return threshold;
};

const resolveBaseRef = async (
  cwd: string,
  base: string | undefined,
): Promise<string> => {
  if (base !== undefined) {
    try {
      await execa("git", ["rev-parse", "--verify", `origin/${base}`], { cwd });
      return `origin/${base}`;
    } catch {
      return base;
    }
  }

  for (const candidate of ["main", "origin/main"]) {
    try {
      const { stdout } = await execa("git", ["merge-base", "HEAD", candidate], {
        cwd,
      });
      return stdout.trim();
    } catch {
      // Try the next common default branch ref.
    }
  }

  throw new Error("Failed to resolve merge-base of HEAD and main.");
};

const getAddedLines = async (
  gitRoot: string,
  baseRef: string,
  repoPath: string,
): Promise<number[]> => {
  try {
    const { stdout } = await execa(
      "git",
      ["diff", baseRef, "--unified=0", "--", repoPath],
      { cwd: gitRoot },
    );

    const lines: number[] = [];
    let currentLine = 0;

    for (const line of stdout.split("\n")) {
      const hunkHeader = line.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/);
      if (hunkHeader) {
        currentLine = Number.parseInt(hunkHeader[1] ?? "0", 10);
        continue;
      }
      if (line.startsWith("+") && !line.startsWith("+++")) {
        lines.push(currentLine);
        currentLine += 1;
      } else if (!line.startsWith("-")) {
        currentLine += 1;
      }
    }

    return lines;
  } catch {
    return [];
  }
};

const resolveDiffFiles = async (options: {
  base?: string;
  cwd: string;
  exclude: RegExp[];
  extensions: string[];
  include: RegExp[];
}): Promise<DiffFile[]> => {
  const cwd = resolve(options.cwd);
  const baseRef = await resolveBaseRef(cwd, options.base);
  const { stdout: gitRootStdout } = await execa(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd },
  );
  const gitRoot = gitRootStdout.trim();
  const { stdout: nameOnly } = await execa(
    "git",
    ["diff", baseRef, "--name-only", "--diff-filter=ACM"],
    { cwd: gitRoot },
  );
  const extensionSet = new Set(options.extensions);
  const allExclude = [...DEFAULT_EXCLUDE_PATTERNS, ...options.exclude];
  const changedFiles = nameOnly
    .split("\n")
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .filter((filePath) => extensionSet.has(extname(filePath).slice(1)))
    .filter(
      (filePath) =>
        options.include.length === 0 ||
        options.include.some((pattern) => pattern.test(filePath)),
    )
    .filter(
      (filePath) => !allExclude.some((pattern) => pattern.test(filePath)),
    );

  if (changedFiles.length === 0) {
    return [];
  }

  const { stdout: diffStat } = await execa(
    "git",
    ["diff", baseRef, "--numstat", "--diff-filter=ACM"],
    { cwd: gitRoot },
  );
  const statMap = diffStat
    .split("\n")
    .filter(Boolean)
    .reduce<Map<string, { additions: number; deletions: number }>>(
      (acc, line) => {
        const [additions, deletions, filePath] = line.split("\t");
        if (filePath !== undefined) {
          acc.set(filePath, {
            additions: Number.parseInt(additions ?? "0", 10) || 0,
            deletions: Number.parseInt(deletions ?? "0", 10) || 0,
          });
        }
        return acc;
      },
      new Map(),
    );

  return Promise.all(
    changedFiles.map(async (repoPath) => {
      const stat = statMap.get(repoPath) ?? { additions: 0, deletions: 0 };
      const addedLines = await getAddedLines(gitRoot, baseRef, repoPath);
      return {
        addedLines,
        path: normalizePath(relative(cwd, join(gitRoot, repoPath))),
        repoPath,
        ...stat,
      };
    }),
  );
};

const resolveOwnV8Path = (): string | null => {
  try {
    return dirname(require.resolve("@vitest/coverage-v8/package.json"));
  } catch {
    return null;
  }
};

const detectVitestCoverageProvider = async (
  cwd: string,
): Promise<CoverageProvider | null> => {
  for (const provider of ["v8", "istanbul"] as const) {
    try {
      await access(
        join(cwd, "node_modules", "@vitest", `coverage-${provider}`),
      );
      return provider;
    } catch {
      // The provider is not installed at this project path.
    }
  }
  return null;
};

const withCoverageProvider = async (
  cwd: string,
  run: (provider: CoverageProvider) => Promise<void>,
): Promise<void> => {
  const projectProvider = await detectVitestCoverageProvider(cwd);
  if (projectProvider !== null) {
    await run(projectProvider);
    return;
  }

  const ownV8Path = resolveOwnV8Path();
  if (ownV8Path === null) {
    throw new Error(
      "No Vitest coverage provider found. Install @vitest/coverage-v8 in your project.",
    );
  }

  const vitestDir = join(cwd, "node_modules", "@vitest");
  const symlinkPath = join(vitestDir, "coverage-v8");
  await mkdir(vitestDir, { recursive: true });
  await rm(symlinkPath, { force: true, recursive: false });
  await symlink(ownV8Path, symlinkPath, "dir");
  try {
    await run("v8");
  } finally {
    await rm(symlinkPath, { force: true, recursive: false });
  }
};

const normalizeCoverageFile = async (
  filePath: string,
  cwd: string,
  preserveKey?: (key: string) => boolean,
): Promise<void> => {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    return;
  }

  const data = JSON.parse(raw) as Record<string, unknown>;
  let changed = false;
  const normalized = Object.fromEntries(
    Object.entries(data).map(([key, value]) => {
      if (preserveKey?.(key) || key.startsWith("/") || /^[A-Z]:\\/.test(key)) {
        return [key, value];
      }
      changed = true;
      return [resolve(cwd, key), value];
    }),
  );

  if (changed) {
    await writeFile(filePath, JSON.stringify(normalized), "utf-8");
  }
};

const normalizeVitestCoverage = async (cwd: string): Promise<void> => {
  await Promise.all([
    normalizeCoverageFile(resolve(cwd, "coverage/coverage-final.json"), cwd),
    normalizeCoverageFile(
      resolve(cwd, "coverage/coverage-summary.json"),
      cwd,
      (key) => key === "total",
    ),
  ]);
};

const runVitest = async (
  cwd: string,
  testCommand: string | undefined,
  diffFiles: DiffFile[],
): Promise<void> => {
  await withCoverageProvider(cwd, async (provider) => {
    const diffFilePaths = diffFiles.map((file) => file.path);
    const includeArgs = diffFilePaths.flatMap((filePath) => [
      "--coverage.include",
      filePath,
    ]);
    const command = testCommand ?? "npx vitest related";
    const [bin, ...baseArgs] = command.split(" ").filter(Boolean);
    if (bin === undefined) {
      throw new Error("Test command must not be empty.");
    }
    const usesRelated = baseArgs.includes("related");
    const result = await execa(
      bin,
      [
        ...baseArgs,
        "--coverage",
        "--coverage.enabled=true",
        `--coverage.provider=${provider}`,
        "--coverage.reporter=json",
        "--coverage.reporter=json-summary",
        "--coverage.all=false",
        ...includeArgs,
        "--passWithNoTests",
        ...(usesRelated ? diffFilePaths : []),
      ],
      {
        cwd,
        env: { ...process.env, CI: "true" },
        reject: false,
        stderr: "inherit",
        stdout: "inherit",
      },
    );

    if (result.exitCode !== 0) {
      throw new Error(`Vitest exited with code ${result.exitCode}.`);
    }
  });

  await normalizeVitestCoverage(cwd);
};

const readCoverageSummary = async (cwd: string): Promise<CoverageSummary> => {
  const raw = await readFile(
    resolve(cwd, "coverage/coverage-summary.json"),
    "utf-8",
  );
  return JSON.parse(raw) as CoverageSummary;
};

const readCoverageFinal = async (
  cwd: string,
): Promise<Record<string, FileDetail | undefined>> => {
  try {
    const raw = await readFile(
      resolve(cwd, "coverage/coverage-final.json"),
      "utf-8",
    );
    return JSON.parse(raw) as Record<string, FileDetail | undefined>;
  } catch {
    return {};
  }
};

const emptyMetric = (): CoverageMetric => ({ covered: 0, pct: 0, total: 0 });

const getUncoveredLines = (fileDetail: FileDetail | undefined): number[] => {
  if (fileDetail?.s === undefined) {
    return [];
  }
  const lines = Object.entries(fileDetail.s)
    .filter(([, count]) => count === 0)
    .map(([id]) => fileDetail.statementMap?.[id]?.start?.line)
    .filter((line): line is number => typeof line === "number");
  return [...new Set(lines)].sort((a, b) => a - b);
};

const addMissingDiffFiles = (
  files: FileCoverage[],
  uncoveredFiles: string[],
  diffFiles: DiffFile[],
  cwd: string,
): void => {
  const coveredPaths = new Set(
    files.map((file) => normalizePath(resolve(cwd, file.path))),
  );
  const missingFiles = diffFiles.filter(
    (file) => !coveredPaths.has(normalizePath(resolve(cwd, file.path))),
  );

  files.push(
    ...missingFiles.map((file) => ({
      branches: emptyMetric(),
      functions: emptyMetric(),
      lines: emptyMetric(),
      path: file.path,
      statements: emptyMetric(),
      uncoveredLines: [],
    })),
  );
  uncoveredFiles.push(...missingFiles.map((file) => file.path));
};

const computePct = (covered: number, total: number): number =>
  total === 0 ? 0 : Math.round((covered / total) * 10000) / 100;

const buildCoverageResult = (
  files: FileCoverage[],
  uncoveredFiles: string[],
  totals: Totals,
): DiffCoverageResult => ({
  files,
  runner: "vitest",
  summary: {
    branches: {
      covered: totals.branchCovered,
      pct: computePct(totals.branchCovered, totals.branchTotal),
      total: totals.branchTotal,
    },
    coveredFiles: files.filter((file) => file.lines.pct > 0).length,
    functions: {
      covered: totals.fnCovered,
      pct: computePct(totals.fnCovered, totals.fnTotal),
      total: totals.fnTotal,
    },
    lines: {
      covered: totals.lineCovered,
      pct: computePct(totals.lineCovered, totals.lineTotal),
      total: totals.lineTotal,
    },
    statements: {
      covered: totals.stmtCovered,
      pct: computePct(totals.stmtCovered, totals.stmtTotal),
      total: totals.stmtTotal,
    },
    totalFiles: files.length,
  },
  timestamp: new Date().toISOString(),
  uncoveredFiles,
});

const computeFileCoverages = (
  summaryData: CoverageSummary,
  detailData: Record<string, FileDetail | undefined>,
  cwd: string,
  diffFiles: DiffFile[],
): DiffCoverageResult => {
  const diffPaths = new Set(
    diffFiles.map((file) => normalizePath(resolve(cwd, file.path))),
  );
  const totals: Totals = {
    branchCovered: 0,
    branchTotal: 0,
    fnCovered: 0,
    fnTotal: 0,
    lineCovered: 0,
    lineTotal: 0,
    stmtCovered: 0,
    stmtTotal: 0,
  };
  const files = Object.entries(summaryData).flatMap(([coveragePath, data]) => {
    if (coveragePath === "total") {
      return [];
    }

    const absPath = normalizePath(resolve(cwd, coveragePath));
    if (!diffPaths.has(absPath)) {
      return [];
    }

    totals.stmtTotal += data.statements.total;
    totals.stmtCovered += data.statements.covered;
    totals.lineTotal += data.lines.total;
    totals.lineCovered += data.lines.covered;
    totals.fnTotal += data.functions.total;
    totals.fnCovered += data.functions.covered;
    totals.branchTotal += data.branches.total;
    totals.branchCovered += data.branches.covered;

    const relPath = normalizePath(relative(cwd, absPath));
    const detail =
      detailData[coveragePath] ?? detailData[absPath] ?? detailData[relPath];
    return [
      {
        branches: data.branches,
        functions: data.functions,
        lines: data.lines,
        path: relPath,
        statements: data.statements,
        uncoveredLines: getUncoveredLines(detail),
      },
    ];
  });
  const uncoveredFiles = files
    .filter((file) => file.lines.pct < 50)
    .map((file) => file.path);

  addMissingDiffFiles(files, uncoveredFiles, diffFiles, cwd);
  return buildCoverageResult(files, uncoveredFiles, totals);
};

const measureCoverage = async (
  cwd: string,
  testCommand: string | undefined,
  diffFiles: DiffFile[],
): Promise<DiffCoverageResult> => {
  await runVitest(cwd, testCommand, diffFiles);
  let summaryData: CoverageSummary;
  try {
    summaryData = await readCoverageSummary(cwd);
  } catch {
    throw new Error(
      "Failed to read coverage report. Check the Vitest output above.",
    );
  }
  const detailData = await readCoverageFinal(cwd);
  return computeFileCoverages(summaryData, detailData, cwd, diffFiles);
};

const getCoverageIcon = (pct: number): string => {
  if (pct >= 80) {
    return "✅";
  }
  if (pct >= 50) {
    return "⚠️";
  }
  return "❌";
};

const formatResult = (
  result: DiffCoverageResult,
  threshold: number | undefined,
): string => {
  const output = [
    "=== Diff Coverage Report (vitest) ===\n",
    `Files changed: ${result.summary.totalFiles}`,
    `Lines:      ${result.summary.lines.pct}% (${result.summary.lines.covered}/${result.summary.lines.total})`,
    `Statements: ${result.summary.statements.pct}% (${result.summary.statements.covered}/${result.summary.statements.total})`,
    `Functions:  ${result.summary.functions.pct}% (${result.summary.functions.covered}/${result.summary.functions.total})`,
    `Branches:   ${result.summary.branches.pct}% (${result.summary.branches.covered}/${result.summary.branches.total})`,
  ];

  if (threshold !== undefined) {
    const passed = result.summary.lines.pct >= threshold;
    output.push(`\nThreshold: ${threshold}% -> ${passed ? "PASS" : "FAIL"}`);
  }

  output.push("\n--- Per File ---");
  output.push(
    ...result.files.flatMap((file) => {
      const lines = [
        `${getCoverageIcon(file.lines.pct)} ${file.path}`,
        `   Lines: ${file.lines.pct}%  Stmts: ${file.statements.pct}%  Fns: ${file.functions.pct}%  Branches: ${file.branches.pct}%`,
      ];
      if (file.uncoveredLines.length > 0) {
        const preview = file.uncoveredLines.slice(0, 10).join(", ");
        const more =
          file.uncoveredLines.length > 10
            ? ` ... (+${file.uncoveredLines.length - 10})`
            : "";
        lines.push(`   Uncovered lines: ${preview}${more}`);
      }
      return lines;
    }),
  );

  return output.join("\n");
};

const formatDiffFiles = (diffFiles: DiffFile[]): string =>
  [
    "Changed source files:",
    ...diffFiles.map(
      (file) => `- ${file.path} (+${file.additions}/-${file.deletions})`,
    ),
  ].join("\n");

const runMeasureCommand = async (
  rawOptions: MeasureCommandOptions,
): Promise<void> => {
  try {
    const cwd = resolve(rawOptions.cwd);
    const diffFiles = await resolveDiffFiles({
      base: rawOptions.base,
      cwd,
      exclude: parseCsv(rawOptions.exclude).map(globToRegex),
      extensions: parseCsv(rawOptions.ext),
      include: parseCsv(rawOptions.include).map(globToRegex),
    });

    if (diffFiles.length === 0) {
      console.log("No changed source files found.");
      return;
    }

    if (rawOptions.diffOnly) {
      console.log(formatDiffFiles(diffFiles));
      return;
    }

    console.error(
      `Measuring diff coverage against ${rawOptions.base ?? "merge-base of HEAD and main"} (runner: vitest)...`,
    );
    console.error(
      `Changed files: ${diffFiles.map((file) => file.path).join(", ")}`,
    );
    console.error("Running Vitest...\n");

    const result = await measureCoverage(cwd, rawOptions.cmd, diffFiles);
    console.log(
      rawOptions.json
        ? JSON.stringify(result, null, 2)
        : formatResult(result, rawOptions.threshold),
    );

    if (
      rawOptions.threshold !== undefined &&
      result.summary.lines.pct < rawOptions.threshold
    ) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error("Error:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
};

export const registerMeasureCommand = (program: Command): void => {
  program
    .command("measure", { isDefault: true })
    .description("Measure Vitest coverage for changed files")
    .option(
      "-b, --base <branch>",
      "Base branch for diff (default: merge-base of HEAD and main)",
    )
    .option("-c, --cwd <path>", "Project root directory", process.cwd())
    .option("--cmd <command>", "Override Vitest command (e.g. 'pnpm vitest')")
    .option(
      "--ext <extensions>",
      "Comma-separated file extensions",
      "ts,tsx,js,jsx",
    )
    .option(
      "--threshold <number>",
      "Fail if line coverage is below this %",
      parseThreshold,
    )
    .option("--json", "Output raw JSON")
    .option("--diff-only", "Only show diff files, don't run tests")
    .option(
      "--exclude <patterns>",
      "Comma-separated glob patterns to exclude files (e.g. '*.mocks.ts,src/fixtures/**')",
    )
    .option(
      "--include <patterns>",
      "Comma-separated glob patterns to include files (e.g. 'src/**,packages/api/**')",
    )
    .action(async (rawOptions: MeasureCommandOptions) => {
      await runMeasureCommand(rawOptions);
    });
};
