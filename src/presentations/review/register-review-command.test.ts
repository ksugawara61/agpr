import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock(
  "../../applications/review/get-structured-review-comments-by-branch.js",
  () => ({
    getStructuredReviewCommentsByBranch: vi.fn(),
  }),
);

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
  it("passes parsed CLI options to the review application", async () => {
    const result = { branch: "feature" };
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockGetStructuredReviewCommentsByBranch.mockResolvedValueOnce(
      result as never,
    );

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
    expect(logSpy).toHaveBeenCalledWith(JSON.stringify(result, null, 2));
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
