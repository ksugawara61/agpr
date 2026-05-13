import { addPullRequestReviewThreadReply } from "@ksugawara61/agpr-repositories/github";

const REVIEW_REPLY_FOOTER = "🤖 create by agpr";

export type ReviewThreadReplyInput = {
  commitHashs: string[];
  message: string;
  threadId: string;
};

type ReviewThreadReplyResult = {
  body?: string;
  createdAt?: string;
  error?: string;
  success: boolean;
  threadId: string;
};

export type ReviewThreadRepliesResult = {
  results: ReviewThreadReplyResult[];
};

const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

export const formatReviewThreadReplyBody = (
  reply: ReviewThreadReplyInput,
): string =>
  [
    reply.message,
    "",
    "Commits:",
    ...reply.commitHashs.map((commitHash) => `- ${commitHash}`),
    "",
    REVIEW_REPLY_FOOTER,
  ].join("\n");

export const replyToReviewThreads = async (args: {
  cwd: string;
  replies: ReviewThreadReplyInput[];
}): Promise<ReviewThreadRepliesResult> => {
  const results: ReviewThreadReplyResult[] = [];

  for (const reply of args.replies) {
    try {
      const postedReply = await addPullRequestReviewThreadReply({
        body: formatReviewThreadReplyBody(reply),
        cwd: args.cwd,
        threadId: reply.threadId,
      });
      results.push({
        body: postedReply.body,
        createdAt: postedReply.createdAt,
        success: true,
        threadId: reply.threadId,
      });
    } catch (error) {
      results.push({
        error: getErrorMessage(error),
        success: false,
        threadId: reply.threadId,
      });
    }
  }

  return { results };
};
