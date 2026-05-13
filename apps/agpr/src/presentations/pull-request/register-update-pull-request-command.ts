import { resolve } from "node:path";
import { readTextFile } from "@agpr/repositories/file-system";
import type { Command } from "commander";
import {
  type UpdatePullRequestInput,
  updatePullRequest,
} from "../../applications/pull-request/update-pull-request.js";

type UpdatePullRequestCommandOptions = {
  cwd: string;
  input: string;
  repo: string;
  template?: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const parseStringField = (value: unknown, path: string): string => {
  if (typeof value !== "string") {
    throw new Error(`${path} must be a string`);
  }
  return value;
};

const parseOptionalStringField = (
  value: unknown,
  path: string,
): string | undefined => {
  if (value === undefined) {
    return undefined;
  }
  return parseStringField(value, path);
};

const parseStringArrayField = (value: unknown, path: string): string[] => {
  if (!isStringArray(value)) {
    throw new Error(`${path} must be a string array`);
  }
  return value;
};

const parseUpdatePullRequestCommandInput = (
  input: string,
): UpdatePullRequestInput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("--input must be valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("--input must be a JSON object");
  }

  return {
    background: parseStringField(parsed.background, "background"),
    branchName: parseStringField(parsed.branchName, "branchName"),
    changes: parseStringArrayField(parsed.changes, "changes"),
    issueId: parseOptionalStringField(parsed.issueId, "issueId"),
  };
};

const parseRepoOption = (repo: string): { owner: string; repo: string } => {
  const [owner, repoName, ...rest] = repo.split("/");
  if (!owner || !repoName || rest.length > 0) {
    throw new Error(`--repo must be in owner/repo format: ${repo}`);
  }
  return { owner, repo: repoName };
};

const readTemplate = async (
  options: UpdatePullRequestCommandOptions,
): Promise<string | undefined> =>
  options.template === undefined
    ? undefined
    : readTextFile(resolve(options.cwd, options.template));

export const registerUpdatePullRequestCommand = (program: Command): void => {
  program
    .command("update-pr")
    .description("Update pull request description with a predefined template")
    .requiredOption(
      "--input <json>",
      "JSON input matching {branchName,background,issueId,changes}",
    )
    .requiredOption("-R, --repo <owner/repo>", "GitHub repository")
    .option("--template <path>", "Markdown template file")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action(async (options: UpdatePullRequestCommandOptions) => {
      const { owner, repo } = parseRepoOption(options.repo);
      const [input, template] = await Promise.all([
        Promise.resolve(parseUpdatePullRequestCommandInput(options.input)),
        readTemplate(options),
      ]);
      const result = await updatePullRequest({
        cwd: options.cwd,
        input,
        owner,
        repo,
        template,
      });
      console.log(JSON.stringify(result, null, 2));
    });
};
