import { type Command, Option } from "commander";
import {
  type ReviewThreadRepliesResult,
  type ReviewThreadReplyInput,
  replyToReviewThreads,
} from "../../applications/review/reply-to-review-threads.js";

type ReviewReplyOutputFormat = "json" | "text";

type ReviewReplyCommandOptions = {
  cwd: string;
  format: ReviewReplyOutputFormat;
  input: string;
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

const formatJsonReviewReplyCommandOutput = (
  result: ReviewThreadRepliesResult,
): string => JSON.stringify(result, null, 2);

const formatTextReviewReplyCommandOutput = (
  result: ReviewThreadRepliesResult,
): string => {
  if (result.results.length === 0) {
    return "# Review Reply Results\n\nNo review replies were sent.";
  }
  return [
    "# Review Reply Results",
    ...result.results.map((replyResult) =>
      [
        "",
        `## Thread: ${replyResult.threadId}`,
        `- Success: ${replyResult.success}`,
        ...(replyResult.createdAt === undefined
          ? []
          : [`- Created At: ${replyResult.createdAt}`]),
        ...(replyResult.error === undefined
          ? []
          : [`- Error: ${replyResult.error}`]),
        ...(replyResult.body === undefined
          ? []
          : ["", "### Body", "", replyResult.body]),
      ].join("\n"),
    ),
  ].join("\n");
};

const formatReviewReplyCommandOutput = (
  result: ReviewThreadRepliesResult,
  format: ReviewReplyOutputFormat,
): string =>
  format === "json"
    ? formatJsonReviewReplyCommandOutput(result)
    : formatTextReviewReplyCommandOutput(result);

export const registerReviewReplyCommand = (program: Command): void => {
  program
    .command("review-reply")
    .description("Reply to GitHub PR review threads")
    .requiredOption(
      "--input <json>",
      "JSON input matching {replies:[{threadId,commitHashs,message}]}",
    )
    .addOption(
      new Option("-f, --format <format>", "Output format")
        .choices(["json", "text"])
        .default("json"),
    )
    .option("--cwd <path>", "Working directory", process.cwd())
    .action(async (options: ReviewReplyCommandOptions) => {
      const input = parseReviewReplyCommandInput(options.input);
      const result = await replyToReviewThreads({
        cwd: options.cwd,
        replies: input.replies,
      });
      console.log(formatReviewReplyCommandOutput(result, options.format));
    });
};
