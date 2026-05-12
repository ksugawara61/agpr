import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/github.js", () => ({
  findPullRequestByBranch: vi.fn(),
  listReviewComments: vi.fn(),
}));

import {
  findPullRequestByBranch,
  type GitHubPullRequest,
  type GitHubReviewComment,
  listReviewComments,
} from "../../repositories/github.js";
import { getStructuredReviewCommentsByBranch } from "./get-structured-review-comments-by-branch.js";

const mockFindPullRequestByBranch = vi.mocked(findPullRequestByBranch);
const mockListReviewComments = vi.mocked(listReviewComments);

const makePullRequest = (
  overrides: Partial<GitHubPullRequest> = {},
): GitHubPullRequest => ({
  baseRefName: "main",
  headRefName: "feature",
  headRefOid: "abc123",
  number: 7,
  state: "OPEN",
  url: "https://github.com/o/r/pull/7",
  ...overrides,
});

const makeReviewComment = (
  overrides: Partial<GitHubReviewComment> = {},
): GitHubReviewComment => ({
  body: "comment",
  created_at: "2026-05-12T00:00:00Z",
  html_url: "https://github.com/o/r/pull/7#discussion_r1",
  id: 1,
  in_reply_to_id: null,
  line: 10,
  path: "src/a.ts",
  pull_request_review_id: 100,
  side: "RIGHT",
  start_line: null,
  start_side: null,
  updated_at: "2026-05-12T00:00:00Z",
  user: { login: "alice" },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getStructuredReviewCommentsByBranch", () => {
  const args = {
    branch: "feature",
    cwd: "/repo",
    owner: "o",
    repo: "r",
  };

  it("returns null when the branch has no open PR", async () => {
    mockFindPullRequestByBranch.mockResolvedValueOnce(null);

    const result = await getStructuredReviewCommentsByBranch(args);

    expect(result).toBeNull();
    expect(mockListReviewComments).not.toHaveBeenCalled();
  });

  it("returns review comments grouped by file and thread", async () => {
    mockFindPullRequestByBranch.mockResolvedValueOnce(
      makePullRequest({ number: 17 }),
    );
    mockListReviewComments.mockResolvedValueOnce([
      makeReviewComment({
        body: "root comment",
        id: 1,
        line: 10,
        path: "src/a.ts",
        user: { login: "alice" },
      }),
      makeReviewComment({
        body: "reply comment",
        id: 2,
        in_reply_to_id: 1,
        line: 10,
        path: "src/a.ts",
        user: { login: "bob" },
      }),
      makeReviewComment({
        body: "other file",
        id: 3,
        line: 20,
        path: "src/b.ts",
        user: null,
      }),
      {
        body: "orphan reply",
        id: 4,
        in_reply_to_id: 999,
        line: 30,
        path: "src/a.ts",
        start_line: null,
      },
    ]);

    const result = await getStructuredReviewCommentsByBranch(args);

    expect(mockListReviewComments).toHaveBeenCalledWith({
      cwd: "/repo",
      owner: "o",
      pullNumber: 17,
      repo: "r",
    });
    expect(result?.pullRequest.number).toBe(17);
    expect(result?.comments.map((comment) => comment.id)).toEqual([1, 2, 3, 4]);
    expect(result?.threads).toMatchObject([
      {
        comments: [
          { author: "alice", body: "root comment", id: 1 },
          { author: "bob", body: "reply comment", id: 2, inReplyToId: 1 },
        ],
        id: 1,
        line: 10,
        path: "src/a.ts",
      },
      {
        comments: [{ author: null, body: "other file", id: 3 }],
        id: 3,
        line: 20,
        path: "src/b.ts",
      },
      {
        comments: [
          {
            author: null,
            body: "orphan reply",
            createdAt: null,
            htmlUrl: null,
            id: 4,
            inReplyToId: 999,
            pullRequestReviewId: null,
            side: null,
            startSide: null,
            updatedAt: null,
          },
        ],
        id: 4,
        line: 30,
        path: "src/a.ts",
      },
    ]);
    expect(result?.files).toMatchObject([
      {
        comments: [{ id: 1 }, { id: 2 }, { id: 4 }],
        path: "src/a.ts",
        threads: [{ id: 1 }, { id: 4 }],
      },
      {
        comments: [{ id: 3 }],
        path: "src/b.ts",
        threads: [{ id: 3 }],
      },
    ]);
  });
});
