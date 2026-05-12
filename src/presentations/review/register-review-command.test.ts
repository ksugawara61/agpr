import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../applications/review/get-structured-review-comments-by-branch.js",
  () => ({
    getStructuredReviewCommentsByBranch: vi.fn(),
  }),
);

import type { BranchReviewComments } from "../../applications/review/get-structured-review-comments-by-branch.js";
import { getStructuredReviewCommentsByBranch } from "../../applications/review/get-structured-review-comments-by-branch.js";
import { registerReviewCommand } from "./register-review-command.js";

const mockGetStructuredReviewCommentsByBranch = vi.mocked(
  getStructuredReviewCommentsByBranch,
);

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
  it("outputs compact review comments grouped by file path", async () => {
    const result: BranchReviewComments = {
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
              id: 101,
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
    } as BranchReviewComments;
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockGetStructuredReviewCommentsByBranch.mockResolvedValueOnce(result);

    await createProgram().parseAsync(
      ["review", "--branch", "feature", "--repo", "o/r", "--cwd", "/repo"],
      { from: "user" },
    );

    expect(mockGetStructuredReviewCommentsByBranch).toHaveBeenCalledWith({
      branch: "feature",
      cwd: "/repo",
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
              threadId: "101",
            },
          ],
        },
      ],
    });
  });

  it("outputs an empty filePaths array when no PR is found", async () => {
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

  it("rejects invalid repo option format", async () => {
    await expect(
      createProgram().parseAsync(
        ["review", "--branch", "feature", "--repo", "invalid"],
        { from: "user" },
      ),
    ).rejects.toThrow("--repo must be in owner/repo format: invalid");
  });
});
