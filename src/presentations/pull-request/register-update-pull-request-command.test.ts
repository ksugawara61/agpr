import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../applications/pull-request/update-pull-request.js", () => ({
  updatePullRequest: vi.fn(),
}));

vi.mock("../../repositories/file-system.js", () => ({
  readTextFile: vi.fn(),
}));

import { updatePullRequest } from "../../applications/pull-request/update-pull-request.js";
import { readTextFile } from "../../repositories/file-system.js";
import { registerUpdatePullRequestCommand } from "./register-update-pull-request-command.js";

const mockUpdatePullRequest = vi.mocked(updatePullRequest);
const mockReadTextFile = vi.mocked(readTextFile);

const makeInput = (overrides: Record<string, unknown> = {}) => ({
  background: "レビュー説明を更新したい",
  branchName: "feature/update-pr",
  changes: ["update PR command", "template rendering"],
  ...overrides,
});

const createProgram = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  registerUpdatePullRequestCommand(program);
  return program;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerUpdatePullRequestCommand", () => {
  it("updates a PR from JSON input", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockUpdatePullRequest.mockResolvedValueOnce({
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/o/r/pull/42",
    });

    await createProgram().parseAsync(
      [
        "update-pr",
        "--repo",
        "o/r",
        "--input",
        JSON.stringify(makeInput()),
        "--cwd",
        "/repo",
      ],
      { from: "user" },
    );

    expect(mockUpdatePullRequest).toHaveBeenCalledWith({
      cwd: "/repo",
      input: {
        background: "レビュー説明を更新したい",
        branchName: "feature/update-pr",
        changes: ["update PR command", "template rendering"],
        issueId: undefined,
      },
      owner: "o",
      repo: "r",
      template: undefined,
    });
    expect(JSON.parse(logSpy.mock.calls[0][0] as string)).toEqual({
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/o/r/pull/42",
    });
  });

  it("reads a markdown template file relative to cwd", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockReadTextFile.mockResolvedValueOnce("## Custom\n\n{{changes}}");
    mockUpdatePullRequest.mockResolvedValueOnce({
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.com/o/r/pull/7",
    });

    await createProgram().parseAsync(
      [
        "update-pr",
        "--repo",
        "o/r",
        "--input",
        JSON.stringify(makeInput({ issueId: "XFE-1" })),
        "--template",
        ".github/pull_request_template.md",
        "--cwd",
        "/repo",
      ],
      { from: "user" },
    );

    expect(mockReadTextFile).toHaveBeenCalledWith(
      "/repo/.github/pull_request_template.md",
    );
    expect(mockUpdatePullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          issueId: "XFE-1",
        }),
        template: "## Custom\n\n{{changes}}",
      }),
    );
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it.each([
    {
      expected: "--input must be valid JSON",
      input: "{",
      name: "rejects invalid JSON",
    },
    {
      expected: "changes must be a string array",
      input: JSON.stringify(makeInput({ changes: "not-array" })),
      name: "rejects invalid changes",
    },
    {
      expected: "branchName must be a string",
      input: JSON.stringify(makeInput({ branchName: undefined })),
      name: "rejects missing branchName",
    },
    {
      expected: "--repo must be in owner/repo format: invalid",
      input: JSON.stringify(makeInput()),
      name: "rejects invalid repo",
      repo: "invalid",
    },
  ])("$name", async ({ input, expected, repo = "o/r" }) => {
    await expect(
      createProgram().parseAsync(
        ["update-pr", "--repo", repo, "--input", input],
        {
          from: "user",
        },
      ),
    ).rejects.toThrow(expected);
  });
});
