import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/github.js", () => ({
  addPullRequestReviewThreadReply: vi.fn(),
}));

import { addPullRequestReviewThreadReply } from "../../repositories/github.js";
import {
  formatReviewThreadReplyBody,
  type ReviewThreadReplyInput,
  replyToReviewThreads,
} from "./reply-to-review-threads.js";

const mockAddPullRequestReviewThreadReply = vi.mocked(
  addPullRequestReviewThreadReply,
);

const makeReplyInput = (
  overrides: Partial<ReviewThreadReplyInput> = {},
): ReviewThreadReplyInput => ({
  commitHashs: ["abc123"],
  message: "対応しました",
  threadId: "PRRT_1",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("formatReviewThreadReplyBody", () => {
  it("returns a message followed by commit hashes", () => {
    expect(
      formatReviewThreadReplyBody(
        makeReplyInput({ commitHashs: ["abc123", "def456"] }),
      ),
    ).toBe(["対応しました", "", "Commits:", "- abc123", "- def456"].join("\n"));
  });
});

describe("replyToReviewThreads", () => {
  it("posts replies and returns successful results", async () => {
    mockAddPullRequestReviewThreadReply.mockResolvedValueOnce({
      body: ["対応しました", "", "Commits:", "- abc123"].join("\n"),
      createdAt: "2026-05-12T00:00:00Z",
      id: 10,
    });

    const result = await replyToReviewThreads({
      cwd: "/repo",
      replies: [makeReplyInput()],
    });

    expect(mockAddPullRequestReviewThreadReply).toHaveBeenCalledWith({
      body: ["対応しました", "", "Commits:", "- abc123"].join("\n"),
      cwd: "/repo",
      threadId: "PRRT_1",
    });
    expect(result).toEqual({
      results: [
        {
          body: ["対応しました", "", "Commits:", "- abc123"].join("\n"),
          createdAt: "2026-05-12T00:00:00Z",
          success: true,
          threadId: "PRRT_1",
        },
      ],
    });
  });

  it("keeps replying after a thread reply fails", async () => {
    mockAddPullRequestReviewThreadReply
      .mockRejectedValueOnce(new Error("not found"))
      .mockResolvedValueOnce({
        body: ["done", "", "Commits:", "- def456"].join("\n"),
        createdAt: "2026-05-12T01:00:00Z",
        id: 11,
      });

    const result = await replyToReviewThreads({
      cwd: "/repo",
      replies: [
        makeReplyInput({ threadId: "PRRT_fail" }),
        makeReplyInput({
          commitHashs: ["def456"],
          message: "done",
          threadId: "PRRT_ok",
        }),
      ],
    });

    expect(result).toEqual({
      results: [
        {
          error: "not found",
          success: false,
          threadId: "PRRT_fail",
        },
        {
          body: ["done", "", "Commits:", "- def456"].join("\n"),
          createdAt: "2026-05-12T01:00:00Z",
          success: true,
          threadId: "PRRT_ok",
        },
      ],
    });
  });
});
