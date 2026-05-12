import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../applications/review/get-structured-review-comments-by-branch.js",
  () => ({
    getStructuredReviewCommentsByBranch: vi.fn(),
  }),
);

vi.mock("../../applications/review/reply-to-review-threads.js", () => ({
  replyToReviewThreads: vi.fn(),
}));

import type { BranchReviewComments } from "../../applications/review/get-structured-review-comments-by-branch.js";
import { getStructuredReviewCommentsByBranch } from "../../applications/review/get-structured-review-comments-by-branch.js";
import { replyToReviewThreads } from "../../applications/review/reply-to-review-threads.js";
import { registerReviewCommand } from "./register-review-command.js";

const mockGetStructuredReviewCommentsByBranch = vi.mocked(
  getStructuredReviewCommentsByBranch,
);
const mockReplyToReviewThreads = vi.mocked(replyToReviewThreads);

const makeBranchReviewComments = (): BranchReviewComments =>
  ({
    branch: "feature",
    comments: [],
    files: [
      {
        comments: [],
        path: "src/a.ts",
        threads: [
          {
            comments: [
              { body: "first comment", id: 1 },
              { body: "reply comment", id: 2 },
            ],
            id: "PRRT_101",
            line: 12,
            path: "src/a.ts",
            startLine: 10,
          },
        ],
      },
    ],
    pullRequest: {
      baseRefName: "main",
      headRefName: "feature",
      headRefOid: "abc123",
      number: 17,
      state: "OPEN",
      url: "https://github.com/o/r/pull/17",
    },
    threads: [],
  }) as BranchReviewComments;

const createProgram = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  registerReviewCommand(program);
  return program;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerReviewCommand", () => {
  it("outputs compact JSON when format is json", async () => {
    const result = makeBranchReviewComments();
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockGetStructuredReviewCommentsByBranch.mockResolvedValueOnce(result);

    await createProgram().parseAsync(
      [
        "review",
        "--branch",
        "feature",
        "--repo",
        "o/r",
        "--cwd",
        "/repo",
        "--format",
        "json",
      ],
      { from: "user" },
    );

    expect(mockGetStructuredReviewCommentsByBranch).toHaveBeenCalledWith({
      branch: "feature",
      cwd: "/repo",
      excludeOutdated: false,
      excludeResolved: false,
      owner: "o",
      repo: "r",
    });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      filePaths: [
        {
          filePath: "src/a.ts",
          reviews: [
            {
              comments: ["first comment", "reply comment"],
              endLine: 12,
              startLine: 10,
              threadId: "PRRT_101",
            },
          ],
        },
      ],
    });
  });

  it("outputs AI-friendly text when format is text", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockGetStructuredReviewCommentsByBranch.mockResolvedValueOnce(
      makeBranchReviewComments(),
    );

    await createProgram().parseAsync(
      ["review", "--branch", "feature", "--repo", "o/r", "--format", "text"],
      { from: "user" },
    );

    expect(logSpy).toHaveBeenCalledWith(
      [
        "# Review Comments",
        "",
        "## File: src/a.ts",
        "",
        "### Thread: PRRT_101",
        "- Lines: 10-12",
        "- Comments:",
        "1. first comment",
        "2. reply comment",
      ].join("\n"),
    );
  });

  it("passes resolved and outdated exclusion options", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockGetStructuredReviewCommentsByBranch.mockResolvedValueOnce(
      makeBranchReviewComments(),
    );

    await createProgram().parseAsync(
      [
        "review",
        "--branch",
        "feature",
        "--repo",
        "o/r",
        "--exclude-resolved",
        "--exclude-outdated",
      ],
      { from: "user" },
    );

    expect(mockGetStructuredReviewCommentsByBranch).toHaveBeenCalledWith({
      branch: "feature",
      cwd: process.cwd(),
      excludeOutdated: true,
      excludeResolved: true,
      owner: "o",
      repo: "r",
    });
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it("outputs an empty JSON filePaths array when no PR is found", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockGetStructuredReviewCommentsByBranch.mockResolvedValueOnce(null);

    await createProgram().parseAsync(
      ["review", "--branch", "feature", "--repo", "o/r"],
      { from: "user" },
    );

    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      filePaths: [],
    });
  });

  it("outputs an AI-friendly empty text result when no PR is found", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockGetStructuredReviewCommentsByBranch.mockResolvedValueOnce(null);

    await createProgram().parseAsync(
      ["review", "--branch", "feature", "--repo", "o/r", "--format", "text"],
      { from: "user" },
    );

    expect(logSpy).toHaveBeenCalledWith(
      "# Review Comments\n\nNo review comments found.",
    );
  });

  it("rejects invalid repo option format", async () => {
    await expect(
      createProgram().parseAsync(
        ["review", "--branch", "feature", "--repo", "invalid"],
        { from: "user" },
      ),
    ).rejects.toThrow("--repo must be in owner/repo format: invalid");
  });

  it("replies to PR review threads from JSON input", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const input = {
      replies: [
        {
          commitHashs: ["abc123", "def456"],
          message: "対応しました",
          threadId: "PRRT_1",
        },
      ],
    };
    mockReplyToReviewThreads.mockResolvedValueOnce({
      results: [
        {
          body: ["対応しました", "", "Commits:", "- abc123", "- def456"].join(
            "\n",
          ),
          createdAt: "2026-05-12T00:00:00Z",
          success: true,
          threadId: "PRRT_1",
        },
      ],
    });

    await createProgram().parseAsync(
      ["review-reply", "--input", JSON.stringify(input), "--cwd", "/repo"],
      { from: "user" },
    );

    expect(mockReplyToReviewThreads).toHaveBeenCalledWith({
      cwd: "/repo",
      replies: input.replies,
    });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      results: [
        {
          body: ["対応しました", "", "Commits:", "- abc123", "- def456"].join(
            "\n",
          ),
          createdAt: "2026-05-12T00:00:00Z",
          success: true,
          threadId: "PRRT_1",
        },
      ],
    });
  });

  it.each([
    {
      expected: "--input must be valid JSON",
      input: "{",
      name: "rejects invalid JSON",
    },
    {
      expected: "replies must be a non-empty array",
      input: JSON.stringify({ replies: [] }),
      name: "rejects empty replies",
    },
    {
      expected: "replies[0].commitHashs must be a non-empty string array",
      input: JSON.stringify({
        replies: [{ commitHashs: [], message: "done", threadId: "PRRT_1" }],
      }),
      name: "rejects empty commitHashs",
    },
  ])("$name", async ({ input, expected }) => {
    await expect(
      createProgram().parseAsync(["review-reply", "--input", input], {
        from: "user",
      }),
    ).rejects.toThrow(expected);
  });
});
