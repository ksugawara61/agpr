import { type ExecaError, execa } from "execa";

type RepoSlug = { owner: string; repo: string };

export type GitHubPullRequest = {
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  number: number;
  state: "OPEN" | "CLOSED" | "MERGED";
  url: string;
};

export type GitHubReviewComment = {
  body: string;
  id: number;
  line: number | null;
  path: string;
  start_line: number | null;
};

export type ReviewCommentInput = {
  body: string;
  line: number;
  path: string;
  side: "RIGHT";
  start_line?: number;
  start_side?: "RIGHT";
};

type CreateReviewParams = {
  body: string;
  comments: ReviewCommentInput[];
  commitId: string;
  cwd: string;
  owner: string;
  pullNumber: number;
  repo: string;
};

export class GhNotInstalledError extends Error {
  code = "NO_GH" as const;
  constructor() {
    super(
      "GitHub CLI (`gh`) is not installed. Install it from https://cli.github.com",
    );
    this.name = "GhNotInstalledError";
  }
}

export class GhNotAuthenticatedError extends Error {
  code = "NO_AUTH" as const;
  constructor() {
    super("GitHub CLI is not authenticated. Run `gh auth login` first.");
    this.name = "GhNotAuthenticatedError";
  }
}

class GhApiError extends Error {
  code = "GH_API" as const;
  constructor(message: string) {
    super(message);
    this.name = "GhApiError";
  }
}

const REPO_URL_PATTERNS: RegExp[] = [
  /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
  /^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?$/,
  /^ssh:\/\/git@github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/,
];

export const parseRepoSlug = (remoteUrl: string): RepoSlug => {
  const trimmed = remoteUrl.trim();
  const match = REPO_URL_PATTERNS.map((re) => trimmed.match(re)).find(
    (m): m is RegExpMatchArray => m !== null,
  );
  if (!match) {
    throw new Error(`Unsupported GitHub remote URL: ${remoteUrl}`);
  }
  return { owner: match[1], repo: match[2] };
};

const isEnoent = (err: unknown): boolean =>
  typeof err === "object" &&
  err !== null &&
  "code" in err &&
  (err as { code?: string }).code === "ENOENT";

const runGh = async (
  args: string[],
  options: { cwd?: string; input?: string } = {},
): Promise<{ stdout: string }> => {
  try {
    const { input, cwd } = options;
    const result = await execa("gh", args, {
      cwd,
      input,
      reject: true,
    });
    return { stdout: result.stdout };
  } catch (err) {
    if (isEnoent(err)) throw new GhNotInstalledError();
    const execErr = err as ExecaError;
    const stderr =
      typeof execErr.stderr === "string" ? execErr.stderr : String(execErr);
    throw new GhApiError(`gh ${args.join(" ")} failed: ${stderr.trim()}`);
  }
};

export const ensureGhAuthenticated = async (): Promise<void> => {
  try {
    await execa("gh", ["auth", "status"], { reject: true });
  } catch (err) {
    if (isEnoent(err)) throw new GhNotInstalledError();
    throw new GhNotAuthenticatedError();
  }
};

const PR_FIELDS = "number,headRefName,headRefOid,baseRefName,state,url";

export const findPullRequestByBranch = async (args: {
  branch: string;
  cwd: string;
  owner: string;
  repo: string;
}): Promise<GitHubPullRequest | null> => {
  const { stdout } = await runGh(
    [
      "pr",
      "list",
      "--repo",
      `${args.owner}/${args.repo}`,
      "--head",
      args.branch,
      "--state",
      "open",
      "--json",
      PR_FIELDS,
    ],
    { cwd: args.cwd },
  );
  const list = JSON.parse(stdout) as GitHubPullRequest[];
  return list.length === 0 ? null : list[0];
};

export const getPullRequest = async (args: {
  cwd: string;
  owner: string;
  pullNumber: number;
  repo: string;
}): Promise<GitHubPullRequest> => {
  const { stdout } = await runGh(
    [
      "pr",
      "view",
      String(args.pullNumber),
      "--repo",
      `${args.owner}/${args.repo}`,
      "--json",
      PR_FIELDS,
    ],
    { cwd: args.cwd },
  );
  return JSON.parse(stdout) as GitHubPullRequest;
};

export const listReviewComments = async (args: {
  cwd: string;
  owner: string;
  pullNumber: number;
  repo: string;
}): Promise<GitHubReviewComment[]> => {
  const { stdout } = await runGh(
    [
      "api",
      "--paginate",
      `repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/comments`,
      "--jq",
      ".[] | {id, path, line, start_line, body}",
    ],
    { cwd: args.cwd },
  );
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as GitHubReviewComment);
};

type GitHubReview = {
  body: string;
  html_url: string;
  id: number;
  state: string;
};

export const listPullRequestReviews = async (args: {
  cwd: string;
  owner: string;
  pullNumber: number;
  repo: string;
}): Promise<GitHubReview[]> => {
  const { stdout } = await runGh(
    [
      "api",
      "--paginate",
      `repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/reviews`,
      "--jq",
      ".[] | {id, body, html_url, state}",
    ],
    { cwd: args.cwd },
  );
  return stdout
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as GitHubReview);
};

export const updateReview = async (args: {
  body: string;
  cwd: string;
  owner: string;
  pullNumber: number;
  repo: string;
  reviewId: number;
}): Promise<{ html_url: string; id: number }> => {
  const { stdout } = await runGh(
    [
      "api",
      "-X",
      "PUT",
      `repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/reviews/${args.reviewId}`,
      "--input",
      "-",
    ],
    { cwd: args.cwd, input: JSON.stringify({ body: args.body }) },
  );
  return JSON.parse(stdout) as { html_url: string; id: number };
};

export const updateReviewComment = async (args: {
  body: string;
  commentId: number;
  cwd: string;
  owner: string;
  repo: string;
}): Promise<void> => {
  await runGh(
    [
      "api",
      "-X",
      "PATCH",
      `repos/${args.owner}/${args.repo}/pulls/comments/${args.commentId}`,
      "--input",
      "-",
    ],
    { cwd: args.cwd, input: JSON.stringify({ body: args.body }) },
  );
};

export const createReviewCommentSingle = async (args: {
  comment: ReviewCommentInput;
  commitId: string;
  cwd: string;
  owner: string;
  pullNumber: number;
  repo: string;
}): Promise<void> => {
  await runGh(
    [
      "api",
      "-X",
      "POST",
      `repos/${args.owner}/${args.repo}/pulls/${args.pullNumber}/comments`,
      "--input",
      "-",
    ],
    {
      cwd: args.cwd,
      input: JSON.stringify({ ...args.comment, commit_id: args.commitId }),
    },
  );
};

export const createReview = async (
  params: CreateReviewParams,
): Promise<{ html_url: string; id: number }> => {
  const payload = {
    body: params.body,
    comments: params.comments,
    commit_id: params.commitId,
    event: "COMMENT" as const,
  };
  const { stdout } = await runGh(
    [
      "api",
      "-X",
      "POST",
      `repos/${params.owner}/${params.repo}/pulls/${params.pullNumber}/reviews`,
      "--input",
      "-",
    ],
    { cwd: params.cwd, input: JSON.stringify(payload) },
  );
  return JSON.parse(stdout) as { html_url: string; id: number };
};
