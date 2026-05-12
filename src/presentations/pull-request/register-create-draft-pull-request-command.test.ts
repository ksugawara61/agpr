import { Command } from "commander";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../applications/pull-request/create-draft-pull-request.js", () => ({
  createDraftPullRequest: vi.fn(),
}));

vi.mock("../../repositories/file-system.js", () => ({
  readTextFile: vi.fn(),
}));

import { createDraftPullRequest } from "../../applications/pull-request/create-draft-pull-request.js";
import { readTextFile } from "../../repositories/file-system.js";
import { registerCreateDraftPullRequestCommand } from "./register-create-draft-pull-request-command.js";

const mockCreateDraftPullRequest = vi.mocked(createDraftPullRequest);
const mockReadTextFile = vi.mocked(readTextFile);

const makeInput = (overrides: Record<string, unknown> = {}) => ({
  background: "レビュー作成を効率化したい",
  changes: ["draft PR command", "template rendering"],
  headBranch: "feature/create-draft-pr",
  title: "Add draft PR command",
  ...overrides,
});

const createProgram = (): Command => {
  const program = new Command();
  program.exitOverride();
  program.configureOutput({
    writeErr: () => undefined,
    writeOut: () => undefined,
  });
  registerCreateDraftPullRequestCommand(program);
  return program;
};

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("registerCreateDraftPullRequestCommand", () => {
  it("creates a draft PR from JSON input", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockCreateDraftPullRequest.mockResolvedValueOnce({
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/o/r/pull/42",
    });

    await createProgram().parseAsync(
      [
        "create-draft-pr",
        "--repo",
        "o/r",
        "--input",
        JSON.stringify(makeInput()),
        "--cwd",
        "/repo",
      ],
      { from: "user" },
    );

    expect(mockCreateDraftPullRequest).toHaveBeenCalledWith({
      copilot: false,
      cwd: "/repo",
      input: {
        background: "レビュー作成を効率化したい",
        baseBranch: "main",
        changes: ["draft PR command", "template rendering"],
        headBranch: "feature/create-draft-pr",
        issueId: undefined,
        title: "Add draft PR command",
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
    mockCreateDraftPullRequest.mockResolvedValueOnce({
      pullRequestNumber: 7,
      pullRequestUrl: "https://github.com/o/r/pull/7",
    });

    await createProgram().parseAsync(
      [
        "create-draft-pr",
        "--repo",
        "o/r",
        "--input",
        JSON.stringify(makeInput({ baseBranch: "develop", issueId: "XFE-1" })),
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
    expect(mockCreateDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        input: expect.objectContaining({
          baseBranch: "develop",
          issueId: "XFE-1",
        }),
        template: "## Custom\n\n{{changes}}",
      }),
    );
    expect(logSpy).toHaveBeenCalledOnce();
  });

  it("passes copilot option to the application", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
    mockCreateDraftPullRequest.mockResolvedValueOnce({
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/o/r/pull/42",
    });

    await createProgram().parseAsync(
      [
        "create-draft-pr",
        "--repo",
        "o/r",
        "--input",
        JSON.stringify(makeInput()),
        "--copilot",
      ],
      { from: "user" },
    );

    expect(mockCreateDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        copilot: true,
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
      expected: "headBranch must be a string",
      input: JSON.stringify(makeInput({ headBranch: undefined })),
      name: "rejects missing headBranch",
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
        ["create-draft-pr", "--repo", repo, "--input", input],
        { from: "user" },
      ),
    ).rejects.toThrow(expected);
  });
});
