import { resolve } from "node:path";
import { readTextFile } from "@agpr/repositories/file-system";
import type { Command } from "commander";
import {
  type CreateDraftPullRequestInput,
  createDraftPullRequest,
} from "../../applications/pull-request/create-draft-pull-request.js";

type CreateDraftPullRequestCommandOptions = {
  copilot: boolean;
  cwd: string;
  input: string;
  repo: string;
  template?: string;
};

type CreateDraftPullRequestCommandInput = CreateDraftPullRequestInput & {
  baseBranch: string;
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

const parseCreateDraftPullRequestCommandInput = (
  input: string,
): CreateDraftPullRequestCommandInput => {
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
    baseBranch:
      parseOptionalStringField(parsed.baseBranch, "baseBranch") ?? "main",
    changes: parseStringArrayField(parsed.changes, "changes"),
    headBranch: parseStringField(parsed.headBranch, "headBranch"),
    issueId: parseOptionalStringField(parsed.issueId, "issueId"),
    title: parseStringField(parsed.title, "title"),
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
  options: CreateDraftPullRequestCommandOptions,
): Promise<string | undefined> =>
  options.template === undefined
    ? undefined
    : readTextFile(resolve(options.cwd, options.template));

export const registerCreateDraftPullRequestCommand = (
  program: Command,
): void => {
  program
    .command("create-draft-pr")
    .description("Create a draft pull request with a predefined template")
    .requiredOption(
      "--input <json>",
      "JSON input matching {title,background,issueId,changes,headBranch,baseBranch}",
    )
    .requiredOption("-R, --repo <owner/repo>", "GitHub repository")
    .option("--copilot", "Request a GitHub Copilot review", false)
    .option("--template <path>", "Markdown template file")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action(async (options: CreateDraftPullRequestCommandOptions) => {
      const { owner, repo } = parseRepoOption(options.repo);
      const [input, template] = await Promise.all([
        Promise.resolve(parseCreateDraftPullRequestCommandInput(options.input)),
        readTemplate(options),
      ]);
      const result = await createDraftPullRequest({
        copilot: options.copilot,
        cwd: options.cwd,
        input,
        owner,
        repo,
        template,
      });
      console.log(JSON.stringify(result, null, 2));
    });
};
