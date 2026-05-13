import {
  findPullRequestByBranch,
  type GitHubPullRequest,
  type GitHubReviewThread,
  type GitHubReviewThreadComment,
  listReviewThreads,
} from "@ksugawara61/agpr-repositories/github";

type StructuredReviewComment = {
  author: string | null;
  body: string;
  createdAt: string | null;
  htmlUrl: string | null;
  id: number;
  inReplyToId: number | null;
  line: number | null;
  path: string;
  pullRequestReviewId: number | null;
  side: "LEFT" | "RIGHT" | null;
  startLine: number | null;
  startSide: "LEFT" | "RIGHT" | null;
  updatedAt: string | null;
};

type StructuredReviewThread = {
  comments: StructuredReviewComment[];
  id: string;
  isOutdated: boolean;
  isResolved: boolean;
  line: number | null;
  path: string;
  side: "LEFT" | "RIGHT" | null;
  startLine: number | null;
  startSide: "LEFT" | "RIGHT" | null;
};

type StructuredReviewFile = {
  comments: StructuredReviewComment[];
  path: string;
  threads: StructuredReviewThread[];
};

type ReviewCommentFilters = {
  excludeOutdated?: boolean;
  excludeResolved?: boolean;
};

export type BranchReviewComments = {
  branch: string;
  comments: StructuredReviewComment[];
  files: StructuredReviewFile[];
  pullRequest: GitHubPullRequest;
  threads: StructuredReviewThread[];
};

const normalizeReviewComment = (
  thread: GitHubReviewThread,
  comment: GitHubReviewThreadComment,
): StructuredReviewComment => ({
  author: comment.author?.login ?? null,
  body: comment.body,
  createdAt: comment.createdAt ?? null,
  htmlUrl: null,
  id: comment.id,
  inReplyToId: null,
  line: thread.line,
  path: thread.path,
  pullRequestReviewId: null,
  side: null,
  startLine: thread.startLine,
  startSide: null,
  updatedAt: comment.updatedAt ?? null,
});

const shouldIncludeThread = (
  thread: GitHubReviewThread,
  filters: ReviewCommentFilters,
): boolean =>
  !(filters.excludeResolved === true && thread.isResolved) &&
  !(filters.excludeOutdated === true && thread.isOutdated);

const structureReviewComments = (
  reviewThreads: GitHubReviewThread[],
  filters: ReviewCommentFilters,
): {
  comments: StructuredReviewComment[];
  files: StructuredReviewFile[];
  threads: StructuredReviewThread[];
} => {
  const threads = reviewThreads
    .filter((thread) => shouldIncludeThread(thread, filters))
    .map(
      (thread): StructuredReviewThread => ({
        comments: thread.comments.map((comment) =>
          normalizeReviewComment(thread, comment),
        ),
        id: thread.id,
        isOutdated: thread.isOutdated,
        isResolved: thread.isResolved,
        line: thread.line,
        path: thread.path,
        side: null,
        startLine: thread.startLine,
        startSide: null,
      }),
    );
  const normalizedComments = threads.flatMap((thread) => thread.comments);
  const filesByPath = threads.reduce<Map<string, StructuredReviewFile>>(
    (acc, thread) => {
      const file = acc.get(thread.path) ?? {
        comments: [],
        path: thread.path,
        threads: [],
      };
      file.threads.push(thread);
      file.comments.push(...thread.comments);
      acc.set(thread.path, file);
      return acc;
    },
    new Map(),
  );
  return {
    comments: normalizedComments,
    files: Array.from(filesByPath.values()),
    threads,
  };
};

export const getStructuredReviewCommentsByBranch = async (args: {
  branch: string;
  cwd: string;
  excludeOutdated?: boolean;
  excludeResolved?: boolean;
  owner: string;
  repo: string;
}): Promise<BranchReviewComments | null> => {
  const pullRequest = await findPullRequestByBranch(args);
  if (pullRequest === null) {
    return null;
  }
  const reviewThreads = await listReviewThreads({
    cwd: args.cwd,
    owner: args.owner,
    pullNumber: pullRequest.number,
    repo: args.repo,
  });
  return {
    branch: args.branch,
    pullRequest,
    ...structureReviewComments(reviewThreads, args),
  };
};
