import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../repositories/github.js", () => ({
  findPullRequestByBranch: vi.fn(),
  listReviewThreads: vi.fn(),
}));

import {
  findPullRequestByBranch,
  type GitHubPullRequest,
  type GitHubReviewThread,
  listReviewThreads,
} from "../../repositories/github.js";
import { getStructuredReviewCommentsByBranch } from "./get-structured-review-comments-by-branch.js";

const mockFindPullRequestByBranch = vi.mocked(findPullRequestByBranch);
const mockListReviewThreads = vi.mocked(listReviewThreads);

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

const makeReviewThread = (
  overrides: Partial<GitHubReviewThread> = {},
): GitHubReviewThread => ({
  comments: [
    {
      author: { login: "alice" },
      body: "comment",
      createdAt: "2026-05-12T00:00:00Z",
      id: 1,
      updatedAt: "2026-05-12T00:00:00Z",
    },
  ],
  id: "PRRT_1",
  isOutdated: false,
  isResolved: false,
  line: 10,
  path: "src/a.ts",
  startLine: null,
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
    expect(mockListReviewThreads).not.toHaveBeenCalled();
  });

  it("returns review comments grouped by file and thread", async () => {
    mockFindPullRequestByBranch.mockResolvedValueOnce(
      makePullRequest({ number: 17 }),
    );
    mockListReviewThreads.mockResolvedValueOnce([
      makeReviewThread({
        comments: [
          {
            author: { login: "alice" },
            body: "root comment",
            createdAt: "2026-05-12T00:00:00Z",
            id: 1,
            updatedAt: "2026-05-12T00:00:00Z",
          },
          {
            author: { login: "bob" },
            body: "reply comment",
            createdAt: "2026-05-12T00:00:00Z",
            id: 2,
            updatedAt: "2026-05-12T00:00:00Z",
          },
        ],
        id: "PRRT_1",
        line: 10,
        path: "src/a.ts",
      }),
      makeReviewThread({
        comments: [
          {
            author: null,
            body: "other file",
            createdAt: "2026-05-12T00:00:00Z",
            id: 3,
            updatedAt: "2026-05-12T00:00:00Z",
          },
        ],
        id: "PRRT_2",
        line: 20,
        path: "src/b.ts",
      }),
    ]);

    const result = await getStructuredReviewCommentsByBranch(args);

    expect(mockListReviewThreads).toHaveBeenCalledWith({
      cwd: "/repo",
      owner: "o",
      pullNumber: 17,
      repo: "r",
    });
    expect(result?.pullRequest.number).toBe(17);
    expect(result?.comments.map((comment) => comment.id)).toEqual([1, 2, 3]);
    expect(result?.threads).toMatchObject([
      {
        comments: [
          { author: "alice", body: "root comment", id: 1 },
          { author: "bob", body: "reply comment", id: 2 },
        ],
        id: "PRRT_1",
        isOutdated: false,
        isResolved: false,
        line: 10,
        path: "src/a.ts",
      },
      {
        comments: [{ author: null, body: "other file", id: 3 }],
        id: "PRRT_2",
        isOutdated: false,
        isResolved: false,
        line: 20,
        path: "src/b.ts",
      },
    ]);
    expect(result?.files).toMatchObject([
      {
        comments: [{ id: 1 }, { id: 2 }],
        path: "src/a.ts",
        threads: [{ id: "PRRT_1" }],
      },
      {
        comments: [{ id: 3 }],
        path: "src/b.ts",
        threads: [{ id: "PRRT_2" }],
      },
    ]);
  });

  it.each([
    {
      expectedThreadIds: ["active", "outdated"],
      filters: { excludeResolved: true },
      name: "excludes resolved review threads",
    },
    {
      expectedThreadIds: ["active", "resolved"],
      filters: { excludeOutdated: true },
      name: "excludes outdated review threads",
    },
    {
      expectedThreadIds: ["active"],
      filters: { excludeOutdated: true, excludeResolved: true },
      name: "excludes both resolved and outdated review threads",
    },
  ])("$name", async ({ filters, expectedThreadIds }) => {
    mockFindPullRequestByBranch.mockResolvedValueOnce(makePullRequest());
    mockListReviewThreads.mockResolvedValueOnce([
      makeReviewThread({ id: "active" }),
      makeReviewThread({ id: "resolved", isResolved: true }),
      makeReviewThread({ id: "outdated", isOutdated: true }),
    ]);

    const result = await getStructuredReviewCommentsByBranch({
      ...args,
      ...filters,
    });

    expect(result?.threads.map((thread) => thread.id)).toEqual(
      expectedThreadIds,
    );
  });
});
