import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@agpr/repositories/github", () => ({
  createDraftPullRequest: vi.fn(),
  requestCopilotReview: vi.fn(),
}));

import {
  createDraftPullRequest as createGitHubDraftPullRequest,
  requestCopilotReview,
} from "@agpr/repositories/github";
import {
  type CreateDraftPullRequestInput,
  createDraftPullRequest,
  renderPullRequestTemplate,
} from "./create-draft-pull-request.js";

const mockCreateGitHubDraftPullRequest = vi.mocked(
  createGitHubDraftPullRequest,
);
const mockRequestCopilotReview = vi.mocked(requestCopilotReview);

const makeInput = (
  overrides: Partial<CreateDraftPullRequestInput> = {},
): CreateDraftPullRequestInput => ({
  background: "レビュー返信を効率化したい",
  changes: ["draft PR command", "template rendering"],
  headBranch: "feature/create-draft-pr",
  title: "Add draft PR command",
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("renderPullRequestTemplate", () => {
  it("replaces double-brace placeholders with input values", () => {
    const template = [
      "# {{ title }}",
      "",
      "Background: {{background}}",
      "Issue: {{issueId}}",
      "Base: {{baseBranch}}",
      "Head: {{headBranch}}",
      "",
      "{{changes}}",
    ].join("\n");

    expect(
      renderPullRequestTemplate(
        template,
        makeInput({ baseBranch: "develop", issueId: "XFE-123" }),
      ),
    ).toBe(
      [
        "# Add draft PR command",
        "",
        "Background: レビュー返信を効率化したい",
        "Issue: XFE-123",
        "Base: develop",
        "Head: feature/create-draft-pr",
        "",
        "- draft PR command",
        "- template rendering",
      ].join("\n"),
    );
  });

  it("keeps unknown placeholders unchanged", () => {
    expect(renderPullRequestTemplate("{{unknown}}", makeInput())).toBe(
      "{{unknown}}",
    );
  });
});

describe("createDraftPullRequest", () => {
  it("creates a draft pull request with the default template", async () => {
    mockCreateGitHubDraftPullRequest.mockResolvedValueOnce({
      number: 42,
      url: "https://github.com/o/r/pull/42",
    });

    const result = await createDraftPullRequest({
      cwd: "/repo",
      input: makeInput(),
      owner: "o",
      repo: "r",
    });

    expect(mockCreateGitHubDraftPullRequest).toHaveBeenCalledWith({
      baseBranch: "main",
      body: [
        "## Background",
        "",
        "レビュー返信を効率化したい",
        "",
        "## Issue",
        "",
        "N/A",
        "",
        "## Changes",
        "",
        "- draft PR command",
        "- template rendering",
      ].join("\n"),
      cwd: "/repo",
      headBranch: "feature/create-draft-pr",
      owner: "o",
      repo: "r",
      title: "Add draft PR command",
    });
    expect(result).toEqual({
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/o/r/pull/42",
    });
  });

  it("creates a draft pull request with a custom template", async () => {
    mockCreateGitHubDraftPullRequest.mockResolvedValueOnce({
      number: 7,
      url: "https://github.com/o/r/pull/7",
    });

    await createDraftPullRequest({
      cwd: "/repo",
      input: makeInput({ baseBranch: "develop", issueId: "#123" }),
      owner: "o",
      repo: "r",
      template: "Issue: {{issueId}}\n{{changes}}",
    });

    expect(mockCreateGitHubDraftPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        baseBranch: "develop",
        body: "Issue: #123\n- draft PR command\n- template rendering",
      }),
    );
  });

  it("requests a Copilot review when copilot is true", async () => {
    mockCreateGitHubDraftPullRequest.mockResolvedValueOnce({
      number: 42,
      url: "https://github.com/o/r/pull/42",
    });

    await createDraftPullRequest({
      copilot: true,
      cwd: "/repo",
      input: makeInput(),
      owner: "o",
      repo: "r",
    });

    expect(mockRequestCopilotReview).toHaveBeenCalledWith({
      cwd: "/repo",
      owner: "o",
      pullNumber: 42,
      repo: "r",
    });
  });
});
