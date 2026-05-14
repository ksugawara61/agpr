const fs = require("node:fs/promises") as typeof import("node:fs/promises");
const path = require("node:path") as typeof import("node:path");

type ClaudePermissions = {
  allow: string[];
  deny: string[];
};

type PermissionDecision = (typeof PERMISSION_DECISIONS)[number];

type PermissionRule = {
  decision: PermissionDecision;
  pattern: string[];
};

const CLAUDE_SETTINGS_PATH = ".claude/settings.json";
const CODEX_RULES_PATH = ".codex/rules/claude.rules";
const PERMISSION_DECISIONS = ["allow", "forbidden"] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJsonObject = async (
  filePath: string,
): Promise<Record<string, unknown>> => {
  const content = await fs.readFile(filePath, "utf8");
  const value: unknown = JSON.parse(content);

  if (!isRecord(value)) {
    throw new Error(`${filePath} must contain a JSON object.`);
  }

  return value;
};

const readStringArray = (value: unknown, fieldPath: string): string[] => {
  if (!Array.isArray(value)) {
    throw new Error(`${fieldPath} must be an array of strings.`);
  }

  const invalidIndex = value.findIndex((item) => typeof item !== "string");

  if (invalidIndex >= 0) {
    throw new Error(`${fieldPath}[${invalidIndex}] must be a string.`);
  }

  return value;
};

const readClaudePermissions = async (): Promise<ClaudePermissions> => {
  const settings = await readJsonObject(CLAUDE_SETTINGS_PATH);
  const { permissions } = settings;

  if (!isRecord(permissions)) {
    throw new Error(`${CLAUDE_SETTINGS_PATH} permissions must be an object.`);
  }

  return {
    allow: readStringArray(permissions.allow, "permissions.allow"),
    deny: readStringArray(permissions.deny, "permissions.deny"),
  };
};

const parseBashPattern = (permission: string): string[] => {
  const match = /^Bash\((.*)\)$/.exec(permission);
  const command = match?.[1];

  if (command == null) {
    throw new Error(
      `Unsupported permission "${permission}". Expected Bash(...).`,
    );
  }

  const withoutTrailingWildcard = command.trim().endsWith("*")
    ? command.trim().slice(0, -1).trimEnd()
    : command.trim();
  const normalizedCommand = withoutTrailingWildcard.endsWith(":")
    ? withoutTrailingWildcard.slice(0, -1)
    : withoutTrailingWildcard;
  const pattern = normalizedCommand
    .split(/\s+/)
    .filter((token) => token !== "");

  if (pattern.length === 0 || pattern.some((token) => token.includes("*"))) {
    throw new Error(`Unsupported Bash permission "${permission}".`);
  }

  return pattern;
};

const toPermissionRule = (
  permission: string,
  decision: PermissionDecision,
): PermissionRule => ({
  decision,
  pattern: parseBashPattern(permission),
});

const formatRule = ({ decision, pattern }: PermissionRule): string =>
  `prefix_rule(pattern=[${pattern.map((token) => JSON.stringify(token)).join(", ")}], decision="${decision}")`;

const writeCodexRules = async (rules: PermissionRule[]): Promise<void> => {
  await fs.mkdir(path.dirname(CODEX_RULES_PATH), { recursive: true });
  await fs.writeFile(CODEX_RULES_PATH, `${rules.map(formatRule).join("\n")}\n`);
};

const formatError = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
};

const main = async (): Promise<void> => {
  const permissions = await readClaudePermissions();
  const rules = [
    ...permissions.allow.map((permission) =>
      toPermissionRule(permission, "allow"),
    ),
    ...permissions.deny.map((permission) =>
      toPermissionRule(permission, "forbidden"),
    ),
  ];

  await writeCodexRules(rules);

  process.stdout.write(
    `${CODEX_RULES_PATH}: synced ${rules.length} prefix rules from ${CLAUDE_SETTINGS_PATH}\n`,
  );
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
