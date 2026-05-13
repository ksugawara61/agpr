const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const path = require("node:path") as typeof import("node:path");

type PackageJson = Record<string, unknown> & {
  version?: unknown;
};

type VersionBump = (typeof VERSION_BUMPS)[number];

type VersionParts = {
  major: number;
  minor: number;
  patch: number;
};

type VersionUpdateResult = {
  currentVersion: string;
  filePath: string;
  nextVersion: string;
};

const VERSION_BUMPS = ["patch", "minor", "major"] as const;
const WORKSPACE_PACKAGE_DIRS = ["apps", "packages"] as const;
const ROOT_PACKAGE_JSON_PATH = "package.json";
const USAGE = "Usage: pnpm verup <patch|minor|major>";

const isVersionBump = (value: string | undefined): value is VersionBump =>
  VERSION_BUMPS.includes(value as VersionBump);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNodeErrorWithCode = (
  error: unknown,
  code: string,
): error is NodeJS.ErrnoException =>
  error instanceof Error && "code" in error && error.code === code;

const readVersionBump = (args: string[]): VersionBump => {
  const [bump, ...extraArgs] = args;

  if (!isVersionBump(bump) || extraArgs.length > 0) {
    throw new Error(USAGE);
  }

  return bump;
};

const readDirectoryEntries = async (
  directoryPath: string,
): Promise<Array<import("node:fs").Dirent>> => {
  try {
    return await fs.readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return [];
    }

    throw error;
  }
};

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return false;
    }

    throw error;
  }
};

const readWorkspacePackageJsonPaths = async (
  workspaceDir: string,
): Promise<string[]> => {
  const entries = await readDirectoryEntries(workspaceDir);
  const packageJsonPaths = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(workspaceDir, entry.name, "package.json"));
  const existingPackageJsonPaths = await Promise.all(
    packageJsonPaths.map(async (filePath) => ({
      exists: await fileExists(filePath),
      filePath,
    })),
  );

  return existingPackageJsonPaths
    .filter(({ exists }) => exists)
    .map(({ filePath }) => filePath);
};

const readPackageJsonPaths = async (): Promise<string[]> => {
  const workspacePackageJsonPaths = await Promise.all(
    WORKSPACE_PACKAGE_DIRS.map((workspaceDir) =>
      readWorkspacePackageJsonPaths(workspaceDir),
    ),
  );

  return [ROOT_PACKAGE_JSON_PATH, ...workspacePackageJsonPaths.flat()];
};

const parseVersion = (version: string, filePath: string): VersionParts => {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);

  if (match == null) {
    throw new Error(
      `${filePath} has unsupported version "${version}". Expected x.y.z.`,
    );
  }

  const [, major, minor, patch] = match;

  if (major == null || minor == null || patch == null) {
    throw new Error(
      `${filePath} has unsupported version "${version}". Expected x.y.z.`,
    );
  }

  return {
    major: Number.parseInt(major, 10),
    minor: Number.parseInt(minor, 10),
    patch: Number.parseInt(patch, 10),
  };
};

const bumpVersion = (
  version: string,
  bump: VersionBump,
  filePath: string,
): string => {
  const current = parseVersion(version, filePath);

  switch (bump) {
    case "patch":
      return `${current.major}.${current.minor}.${current.patch + 1}`;
    case "minor":
      return `${current.major}.${current.minor + 1}.0`;
    case "major":
      return `${current.major + 1}.0.0`;
  }
};

const readPackageJson = async (filePath: string): Promise<PackageJson> => {
  const content = await fs.readFile(filePath, "utf8");
  const packageJson: unknown = JSON.parse(content);

  if (!isRecord(packageJson)) {
    throw new Error(`${filePath} must contain a JSON object.`);
  }

  return packageJson;
};

const updatePackageVersion = async (
  filePath: string,
  bump: VersionBump,
): Promise<VersionUpdateResult> => {
  const packageJson = await readPackageJson(filePath);

  if (typeof packageJson.version !== "string") {
    throw new Error(`${filePath} must contain a string version.`);
  }

  const currentVersion = packageJson.version;
  const nextVersion = bumpVersion(currentVersion, bump, filePath);
  const nextPackageJson = { ...packageJson, version: nextVersion };

  await fs.writeFile(filePath, `${JSON.stringify(nextPackageJson, null, 2)}\n`);

  return {
    currentVersion,
    filePath,
    nextVersion,
  };
};

const formatUpdateResult = ({
  currentVersion,
  filePath,
  nextVersion,
}: VersionUpdateResult): string =>
  `${filePath}: ${currentVersion} -> ${nextVersion}`;

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const main = async (): Promise<void> => {
  const bump = readVersionBump(process.argv.slice(2));
  const packageJsonPaths = await readPackageJsonPaths();
  const updateResults = await Promise.all(
    packageJsonPaths.map((filePath) => updatePackageVersion(filePath, bump)),
  );

  process.stdout.write(`${updateResults.map(formatUpdateResult).join("\n")}\n`);
};

const run = async (): Promise<void> => {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${formatError(error)}\n`);
    process.exitCode = 1;
  }
};

void run();
