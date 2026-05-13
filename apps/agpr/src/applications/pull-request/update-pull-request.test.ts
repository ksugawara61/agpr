import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@ksugawara61/agpr-repositories/github", () => ({
  findPullRequestByBranch: vi.fn(),
  updatePullRequestDescription: vi.fn(),
}));

import {
  findPullRequestByBranch,
  type GitHubPullRequest,
  updatePullRequestDescription,
} from "@ksugawara61/agpr-repositories/github";
import {
  renderUpdatePullRequestTemplate,
  type UpdatePullRequestInput,
  updatePullRequest,
} from "./update-pull-request.js";

const mockFindPullRequestByBranch = vi.mocked(findPullRequestByBranch);
const mockUpdatePullRequestDescription = vi.mocked(
  updatePullRequestDescription,
);

const makeInput = (
  overrides: Partial<UpdatePullRequestInput> = {},
): UpdatePullRequestInput => ({
  background: "レビュー説明を更新したい",
  branchName: "feature/update-pr",
  changes: ["update PR command", "template rendering"],
  ...overrides,
});

const makePullRequest = (
  overrides: Partial<GitHubPullRequest> = {},
): GitHubPullRequest => ({
  baseRefName: "main",
  headRefName: "feature/update-pr",
  headRefOid: "abc123",
  number: 42,
  state: "OPEN",
  url: "https://github.com/o/r/pull/42",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderUpdatePullRequestTemplate", () => {
  it("replaces double-brace placeholders with input values", () => {
    const template = [
      "Branch: {{branchName}}",
      "Background: {{background}}",
      "Issue: {{issueId}}",
      "",
      "{{changes}}",
    ].join("\n");

    expect(
      renderUpdatePullRequestTemplate(
        template,
        makeInput({ issueId: "XFE-123" }),
      ),
    ).toBe(
      [
        "Branch: feature/update-pr",
        "Background: レビュー説明を更新したい",
        "Issue: XFE-123",
        "",
        "- update PR command",
        "- template rendering",
      ].join("\n"),
    );
  });

  it("keeps unknown placeholders unchanged", () => {
    expect(renderUpdatePullRequestTemplate("{{unknown}}", makeInput())).toBe(
      "{{unknown}}",
    );
  });
});

describe("updatePullRequest", () => {
  it("updates an open pull request found by branch name", async () => {
    mockFindPullRequestByBranch.mockResolvedValueOnce(makePullRequest());
    mockUpdatePullRequestDescription.mockResolvedValueOnce({
      number: 42,
      url: "https://github.com/o/r/pull/42",
    });

    const result = await updatePullRequest({
      cwd: "/repo",
      input: makeInput(),
      owner: "o",
      repo: "r",
    });

    expect(mockFindPullRequestByBranch).toHaveBeenCalledWith({
      branch: "feature/update-pr",
      cwd: "/repo",
      owner: "o",
      repo: "r",
    });
    expect(mockUpdatePullRequestDescription).toHaveBeenCalledWith({
      body: [
        "## Background",
        "",
        "レビュー説明を更新したい",
        "",
        "## Issue",
        "",
        "N/A",
        "",
        "## Changes",
        "",
        "- update PR command",
        "- template rendering",
      ].join("\n"),
      cwd: "/repo",
      owner: "o",
      pullNumber: 42,
      repo: "r",
    });
    expect(result).toEqual({
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/o/r/pull/42",
    });
  });

  it("updates the pull request with a custom template", async () => {
    mockFindPullRequestByBranch.mockResolvedValueOnce(makePullRequest());
    mockUpdatePullRequestDescription.mockResolvedValueOnce({
      number: 42,
      url: "https://github.com/o/r/pull/42",
    });

    await updatePullRequest({
      cwd: "/repo",
      input: makeInput({ issueId: "#123" }),
      owner: "o",
      repo: "r",
      template: "Issue: {{issueId}}\n{{changes}}",
    });

    expect(mockUpdatePullRequestDescription).toHaveBeenCalledWith(
      expect.objectContaining({
        body: "Issue: #123\n- update PR command\n- template rendering",
      }),
    );
  });

  it("throws when no open pull request is found for the branch", async () => {
    mockFindPullRequestByBranch.mockResolvedValueOnce(null);

    await expect(
      updatePullRequest({
        cwd: "/repo",
        input: makeInput(),
        owner: "o",
        repo: "r",
      }),
    ).rejects.toThrow(
      "No open pull request found for branch: feature/update-pr",
    );
    expect(mockUpdatePullRequestDescription).not.toHaveBeenCalled();
  });
});
