import {
  access,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { execa } from "execa";

type CoverageProvider = "v8" | "istanbul";

const require = createRequire(import.meta.url);

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

export const runVitest = async (options: {
  cwd: string;
  diffFilePaths: string[];
  testCommand?: string;
}): Promise<void> => {
  await withCoverageProvider(options.cwd, async (provider) => {
    const includeArgs = options.diffFilePaths.flatMap((filePath) => [
      "--coverage.include",
      filePath,
    ]);
    const command = options.testCommand ?? "npx vitest related";
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
        ...(usesRelated ? options.diffFilePaths : []),
      ],
      {
        cwd: options.cwd,
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

  await normalizeVitestCoverage(options.cwd);
};
