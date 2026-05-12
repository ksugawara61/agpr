import {
  findPullRequestByBranch,
  type GitHubPullRequest,
  type GitHubReviewComment,
  listReviewComments,
} from "../../repositories/github.js";

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
  id: number;
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

export type BranchReviewComments = {
  branch: string;
  comments: StructuredReviewComment[];
  files: StructuredReviewFile[];
  pullRequest: GitHubPullRequest;
  threads: StructuredReviewThread[];
};

const normalizeReviewComment = (
  comment: GitHubReviewComment,
): StructuredReviewComment => ({
  author: comment.user?.login ?? null,
  body: comment.body,
  createdAt: comment.created_at ?? null,
  htmlUrl: comment.html_url ?? null,
  id: comment.id,
  inReplyToId: comment.in_reply_to_id ?? null,
  line: comment.line,
  path: comment.path,
  pullRequestReviewId: comment.pull_request_review_id ?? null,
  side: comment.side ?? null,
  startLine: comment.start_line,
  startSide: comment.start_side ?? null,
  updatedAt: comment.updated_at ?? null,
});

const createThread = (
  rootComment: StructuredReviewComment,
): StructuredReviewThread => ({
  comments: [],
  id: rootComment.id,
  line: rootComment.line,
  path: rootComment.path,
  side: rootComment.side,
  startLine: rootComment.startLine,
  startSide: rootComment.startSide,
});

const structureReviewComments = (
  comments: GitHubReviewComment[],
): {
  comments: StructuredReviewComment[];
  files: StructuredReviewFile[];
  threads: StructuredReviewThread[];
} => {
  const normalizedComments = comments.map(normalizeReviewComment);
  const commentsById = normalizedComments.reduce<
    Map<number, StructuredReviewComment>
  >((acc, comment) => acc.set(comment.id, comment), new Map());
  const threadsById = normalizedComments.reduce<
    Map<number, StructuredReviewThread>
  >((acc, comment) => {
    const rootComment =
      comment.inReplyToId === null
        ? comment
        : (commentsById.get(comment.inReplyToId) ?? comment);
    const thread = acc.get(rootComment.id) ?? createThread(rootComment);
    thread.comments.push(comment);
    acc.set(rootComment.id, thread);
    return acc;
  }, new Map());
  const threads = Array.from(threadsById.values());
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
  owner: string;
  repo: string;
}): Promise<BranchReviewComments | null> => {
  const pullRequest = await findPullRequestByBranch(args);
  if (pullRequest === null) {
    return null;
  }
  const comments = await listReviewComments({
    cwd: args.cwd,
    owner: args.owner,
    pullNumber: pullRequest.number,
    repo: args.repo,
  });
  return {
    branch: args.branch,
    pullRequest,
    ...structureReviewComments(comments),
  };
};
