import { extname, join, relative, resolve } from "node:path";
import { execa } from "execa";

export type DiffFile = {
  addedLines: number[];
  additions: number;
  deletions: number;
  path: string;
  repoPath: string;
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

const normalizePath = (path: string): string => path.split("\\").join("/");

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

export const getDiffFiles = async (options: {
  base?: string;
  cwd: string;
  excludePatterns: RegExp[];
  extensions: string[];
  includePatterns: RegExp[];
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
  const allExclude = [...DEFAULT_EXCLUDE_PATTERNS, ...options.excludePatterns];
  const changedFiles = nameOnly
    .split("\n")
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .filter((filePath) => extensionSet.has(extname(filePath).slice(1)))
    .filter(
      (filePath) =>
        options.includePatterns.length === 0 ||
        options.includePatterns.some((pattern) => pattern.test(filePath)),
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
