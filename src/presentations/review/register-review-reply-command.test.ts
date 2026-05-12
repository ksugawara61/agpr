import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../applications/review/reply-to-review-threads.js", () => ({
  replyToReviewThreads: vi.fn(),
}));

import { replyToReviewThreads } from "../../applications/review/reply-to-review-threads.js";
import { registerReviewReplyCommand } from "./register-review-reply-command.js";

const mockReplyToReviewThreads = vi.mocked(replyToReviewThreads);

const makeReplyBody = (): string =>
  [
    "対応しました",
    "",
    "Commits:",
    "- abc123",
    "- def456",
    "",
    "🤖 create by agpr",
  ].join("\n");

const createProgram = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  registerReviewReplyCommand(program);
  return program;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerReviewReplyCommand", () => {
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
          body: makeReplyBody(),
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
          body: makeReplyBody(),
          createdAt: "2026-05-12T00:00:00Z",
          success: true,
          threadId: "PRRT_1",
        },
      ],
    });
  });

  it("outputs markdown when format is markdown", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    const input = {
      replies: [
        {
          commitHashs: ["abc123"],
          message: "対応しました",
          threadId: "PRRT_1",
        },
      ],
    };
    mockReplyToReviewThreads.mockResolvedValueOnce({
      results: [
        {
          body: makeReplyBody(),
          createdAt: "2026-05-12T00:00:00Z",
          success: true,
          threadId: "PRRT_1",
        },
        {
          error: "not found",
          success: false,
          threadId: "PRRT_2",
        },
      ],
    });

    await createProgram().parseAsync(
      [
        "review-reply",
        "--input",
        JSON.stringify(input),
        "--format",
        "markdown",
      ],
      { from: "user" },
    );

    expect(logSpy).toHaveBeenCalledWith(
      [
        "# Review Reply Results",
        "",
        "## Thread: PRRT_1",
        "- Success: true",
        "- Created At: 2026-05-12T00:00:00Z",
        "",
        "### Body",
        "",
        makeReplyBody(),
        "",
        "## Thread: PRRT_2",
        "- Success: false",
        "- Error: not found",
      ].join("\n"),
    );
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
