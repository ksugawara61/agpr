import {
  findPullRequestByBranch,
  type GitHubCreatedPullRequest,
  updatePullRequestDescription,
} from "@ksugawara61/agpr-repositories/github";

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

export type UpdatePullRequestInput = {
  background: string;
  branchName: string;
  changes: string[];
  issueId?: string;
};

export type UpdatePullRequestOutput = {
  pullRequestNumber: number;
  pullRequestUrl: string;
};

type PullRequestTemplateValues = Record<string, string>;

const formatChanges = (changes: string[]): string =>
  changes.map((change) => `- ${change}`).join("\n");

const toTemplateValues = (
  input: UpdatePullRequestInput,
): PullRequestTemplateValues => ({
  background: input.background,
  branchName: input.branchName,
  changes: formatChanges(input.changes),
  issueId: input.issueId ?? "N/A",
});

const toOutput = (
  pullRequest: GitHubCreatedPullRequest,
): UpdatePullRequestOutput => ({
  pullRequestNumber: pullRequest.number,
  pullRequestUrl: pullRequest.url,
});

export const renderUpdatePullRequestTemplate = (
  template: string,
  input: UpdatePullRequestInput,
): string => {
  const values = toTemplateValues(input);
  return template.replace(
    /{{\s*([a-zA-Z0-9_]+)\s*}}/g,
    (placeholder, key: string) => values[key] ?? placeholder,
  );
};

export const updatePullRequest = async (args: {
  cwd: string;
  input: UpdatePullRequestInput;
  owner: string;
  repo: string;
  template?: string;
}): Promise<UpdatePullRequestOutput> => {
  const pullRequest = await findPullRequestByBranch({
    branch: args.input.branchName,
    cwd: args.cwd,
    owner: args.owner,
    repo: args.repo,
  });
  if (pullRequest === null) {
    throw new Error(
      `No open pull request found for branch: ${args.input.branchName}`,
    );
  }

  const body = renderUpdatePullRequestTemplate(
    args.template ?? DEFAULT_PULL_REQUEST_TEMPLATE,
    args.input,
  );
  const updatedPullRequest = await updatePullRequestDescription({
    body,
    cwd: args.cwd,
    owner: args.owner,
    pullNumber: pullRequest.number,
    repo: args.repo,
  });
  return toOutput(updatedPullRequest);
};
