import { type Command, Option } from "commander";
import {
  type BranchReviewComments,
  getStructuredReviewCommentsByBranch,
} from "../../applications/review/get-structured-review-comments-by-branch.js";
import {
  type ReviewThreadRepliesResult,
  type ReviewThreadReplyInput,
  replyToReviewThreads,
} from "../../applications/review/reply-to-review-threads.js";

type OutputFormat = "json" | "text";

type ReviewCommandOptions = {
  branch: string;
  cwd: string;
  excludeOutdated: boolean;
  excludeResolved: boolean;
  format: OutputFormat;
  repo: string;
};

type ReviewReplyCommandOptions = {
  cwd: string;
  input: string;
};

type ReviewCommandOutput = {
  filePaths: {
    filePath: string;
    reviews: {
      comments: string[];
      endLine: number | null;
      startLine: number | null;
      threadId: string;
    }[];
  }[];
};

type ReviewReplyCommandInput = {
  replies: ReviewThreadReplyInput[];
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

const parseCommitHashs = (value: unknown, path: string): string[] => {
  if (!isStringArray(value) || value.length === 0) {
    throw new Error(`${path} must be a non-empty string array`);
  }
  return value;
};

const parseReviewReply = (
  value: unknown,
  index: number,
): ReviewThreadReplyInput => {
  const path = `replies[${index}]`;
  if (!isRecord(value)) {
    throw new Error(`${path} must be an object`);
  }
  return {
    commitHashs: parseCommitHashs(value.commitHashs, `${path}.commitHashs`),
    message: parseStringField(value.message, `${path}.message`),
    threadId: parseStringField(value.threadId, `${path}.threadId`),
  };
};

const parseReviewReplyCommandInput = (
  input: string,
): ReviewReplyCommandInput => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new Error("--input must be valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("--input must be a JSON object");
  }
  if (!Array.isArray(parsed.replies) || parsed.replies.length === 0) {
    throw new Error("replies must be a non-empty array");
  }
  return {
    replies: parsed.replies.map((reply, index) =>
      parseReviewReply(reply, index),
    ),
  };
};

const parseRepoOption = (repo: string): { owner: string; repo: string } => {
  const [owner, repoName, ...rest] = repo.split("/");
  if (!owner || !repoName || rest.length > 0) {
    throw new Error(`--repo must be in owner/repo format: ${repo}`);
  }
  return { owner, repo: repoName };
};

const formatReviewCommandOutput = (
  result: BranchReviewComments | null,
): ReviewCommandOutput => ({
  filePaths:
    result?.files.map((file) => ({
      filePath: file.path,
      reviews: file.threads.map((thread) => ({
        comments: thread.comments.map((comment) => comment.body),
        endLine: thread.line,
        startLine: thread.startLine,
        threadId: String(thread.id),
      })),
    })) ?? [],
});

const formatLineRange = (
  startLine: number | null,
  endLine: number | null,
): string => {
  const start = startLine === null ? "null" : String(startLine);
  const end = endLine === null ? "null" : String(endLine);
  return `${start}-${end}`;
};

const formatTextReviewCommandOutput = (
  result: BranchReviewComments | null,
): string => {
  const output = formatReviewCommandOutput(result);
  if (output.filePaths.length === 0) {
    return "# Review Comments\n\nNo review comments found.";
  }
  return [
    "# Review Comments",
    ...output.filePaths.map((file) =>
      [
        "",
        `## File: ${file.filePath}`,
        ...file.reviews.map((review) =>
          [
            "",
            `### Thread: ${review.threadId}`,
            `- Lines: ${formatLineRange(review.startLine, review.endLine)}`,
            "- Comments:",
            ...review.comments.map(
              (comment, index) => `${index + 1}. ${comment}`,
            ),
          ].join("\n"),
        ),
      ].join("\n"),
    ),
  ].join("\n");
};

const formatCommandOutput = (
  result: BranchReviewComments | null,
  format: OutputFormat,
): string =>
  format === "json"
    ? JSON.stringify(formatReviewCommandOutput(result), null, 2)
    : formatTextReviewCommandOutput(result);

const formatReviewReplyCommandOutput = (
  result: ReviewThreadRepliesResult,
): string => JSON.stringify(result, null, 2);

export const registerReviewCommand = (program: Command): void => {
  program
    .command("review")
    .description("Fetch structured PR review comments for a branch")
    .requiredOption("-b, --branch <branch>", "PR head branch name")
    .requiredOption("-R, --repo <owner/repo>", "GitHub repository")
    .option("--exclude-resolved", "Exclude resolved review threads", false)
    .option("--exclude-outdated", "Exclude outdated review threads", false)
    .addOption(
      new Option("-f, --format <format>", "Output format")
        .choices(["json", "text"])
        .default("json"),
    )
    .option("--cwd <path>", "Working directory", process.cwd())
    .action(async (options: ReviewCommandOptions) => {
      const { owner, repo } = parseRepoOption(options.repo);
      const result = await getStructuredReviewCommentsByBranch({
        branch: options.branch,
        cwd: options.cwd,
        excludeOutdated: options.excludeOutdated,
        excludeResolved: options.excludeResolved,
        owner,
        repo,
      });
      console.log(formatCommandOutput(result, options.format));
    });

  program
    .command("review-reply")
    .description("Reply to GitHub PR review threads")
    .requiredOption(
      "--input <json>",
      "JSON input matching {replies:[{threadId,commitHashs,message}]}",
    )
    .option("--cwd <path>", "Working directory", process.cwd())
    .action(async (options: ReviewReplyCommandOptions) => {
      const input = parseReviewReplyCommandInput(options.input);
      const result = await replyToReviewThreads({
        cwd: options.cwd,
        replies: input.replies,
      });
      console.log(formatReviewReplyCommandOutput(result));
    });
};
