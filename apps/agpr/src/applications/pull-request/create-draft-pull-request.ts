import {
  createDraftPullRequest as createGitHubDraftPullRequest,
  type GitHubCreatedPullRequest,
  requestCopilotReview,
} from "@agpr/repositories/github";

const DEFAULT_BASE_BRANCH = "main";

const DEFAULT_PULL_REQUEST_TEMPLATE = [
  "## Background",
  "",
  "{{background}}",
  "",
  "## Issue",
  "",
  "{{issueId}}",
  "",
  "## Changes",
  "",
  "{{changes}}",
].join("\n");

export type CreateDraftPullRequestInput = {
  background: string;
  baseBranch?: string;
  changes: string[];
  headBranch: string;
  issueId?: string;
  title: string;
};

export type CreateDraftPullRequestOutput = {
  pullRequestNumber: number;
  pullRequestUrl: string;
};

type PullRequestTemplateValues = Record<string, string>;

const formatChanges = (changes: string[]): string =>
  changes.map((change) => `- ${change}`).join("\n");

const toTemplateValues = (
  input: CreateDraftPullRequestInput,
): PullRequestTemplateValues => ({
  background: input.background,
  baseBranch: input.baseBranch ?? DEFAULT_BASE_BRANCH,
  changes: formatChanges(input.changes),
  headBranch: input.headBranch,
  issueId: input.issueId ?? "N/A",
  title: input.title,
});

const toOutput = (
  pullRequest: GitHubCreatedPullRequest,
): CreateDraftPullRequestOutput => ({
  pullRequestNumber: pullRequest.number,
  pullRequestUrl: pullRequest.url,
});

export const renderPullRequestTemplate = (
  template: string,
  input: CreateDraftPullRequestInput,
): string => {
  const values = toTemplateValues(input);
  return template.replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (placeholder, key: string) => values[key] ?? placeholder,
  );
};

export const createDraftPullRequest = async (args: {
  copilot?: boolean;
  cwd: string;
  input: CreateDraftPullRequestInput;
  owner: string;
  repo: string;
  template?: string;
}): Promise<CreateDraftPullRequestOutput> => {
  const baseBranch = args.input.baseBranch ?? DEFAULT_BASE_BRANCH;
  const body = renderPullRequestTemplate(
    args.template ?? DEFAULT_PULL_REQUEST_TEMPLATE,
    {
      ...args.input,
      baseBranch,
    },
  );
  const pullRequest = await createGitHubDraftPullRequest({
    baseBranch,
    body,
    cwd: args.cwd,
    headBranch: args.input.headBranch,
    owner: args.owner,
    repo: args.repo,
    title: args.input.title,
  });
  if (args.copilot === true) {
    await requestCopilotReview({
      cwd: args.cwd,
      owner: args.owner,
      pullNumber: pullRequest.number,
      repo: args.repo,
    });
  }
  return toOutput(pullRequest);
};
