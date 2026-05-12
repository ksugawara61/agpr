import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(),
}));

import { execa } from "execa";
import {
  createReview,
  createReviewCommentSingle,
  ensureGhAuthenticated,
  findPullRequestByBranch,
  GhNotAuthenticatedError,
  GhNotInstalledError,
  getPullRequest,
  listPullRequestReviews,
  listReviewComments,
  listReviewThreads,
  parseRepoSlug,
  updateReview,
  updateReviewComment,
} from "./github.js";

const mockExeca = vi.mocked(execa);

const stubOk = (stdout = "") =>
  mockExeca.mockResolvedValueOnce({ stdout } as never);

const stubFail = (stderr = "boom", code?: string) => {
  const err = Object.assign(new Error(stderr), { code, stderr });
  return mockExeca.mockRejectedValueOnce(err);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("parseRepoSlug", () => {
  it.each([
    {
      expected: { owner: "ksugawara61", repo: "diff-coverage" },
      input: "https://github.com/ksugawara61/diff-coverage.git",
      name: "HTTPS with .git",
    },
    {
      expected: { owner: "ksugawara61", repo: "diff-coverage" },
      input: "https://github.com/ksugawara61/diff-coverage",
      name: "HTTPS without .git",
    },
    {
      expected: { owner: "ksugawara61", repo: "diff-coverage" },
      input: "git@github.com:ksugawara61/diff-coverage.git",
      name: "SSH shorthand with .git",
    },
    {
      expected: { owner: "ksugawara61", repo: "diff-coverage" },
      input: "git@github.com:ksugawara61/diff-coverage",
      name: "SSH shorthand without .git",
    },
    {
      expected: { owner: "ksugawara61", repo: "diff-coverage" },
      input: "ssh://git@github.com/ksugawara61/diff-coverage.git",
      name: "ssh:// URL",
    },
  ])("$name → owner/repo", ({ input, expected }) => {
    expect(parseRepoSlug(input)).toEqual(expected);
  });

  it("throws on a non-GitHub URL", () => {
    expect(() => parseRepoSlug("https://gitlab.com/owner/repo.git")).toThrow(
      /Unsupported GitHub remote URL/,
    );
  });
});

describe("ensureGhAuthenticated", () => {
  it("resolves when `gh auth status` succeeds", async () => {
    stubOk("Logged in to github.com");
    await expect(ensureGhAuthenticated()).resolves.toBeUndefined();
  });

  it("throws GhNotInstalledError when `gh` is missing", async () => {
    stubFail("spawn gh ENOENT", "ENOENT");
    await expect(ensureGhAuthenticated()).rejects.toBeInstanceOf(
      GhNotInstalledError,
    );
  });

  it("throws GhNotAuthenticatedError when `gh auth status` exits non-zero", async () => {
    stubFail("not logged in");
    await expect(ensureGhAuthenticated()).rejects.toBeInstanceOf(
      GhNotAuthenticatedError,
    );
  });
});

describe("findPullRequestByBranch", () => {
  const args = {
    branch: "feature",
    cwd: "/repo",
    owner: "ksugawara61",
    repo: "diff-coverage",
  };

  it("returns null when gh returns an empty array", async () => {
    stubOk("[]");
    expect(await findPullRequestByBranch(args)).toBeNull();
  });

  it("returns the first PR when results are present", async () => {
    stubOk(
      JSON.stringify([
        {
          baseRefName: "main",
          headRefName: "feature",
          headRefOid: "abc123",
          number: 7,
          state: "OPEN",
          url: "https://github.com/x/y/pull/7",
        },
      ]),
    );
    const pr = await findPullRequestByBranch(args);
    expect(pr?.number).toBe(7);
    expect(pr?.headRefOid).toBe("abc123");
  });

  it("invokes gh with --repo, --head and --state flags", async () => {
    stubOk("[]");
    await findPullRequestByBranch(args);
    const call = mockExeca.mock.calls[0];
    expect(call[0]).toBe("gh");
    expect(call[1]).toContain("pr");
    expect(call[1]).toContain("list");
    expect(call[1]).toContain("--head");
    expect(call[1]).toContain("feature");
    expect(call[1]).toContain("--repo");
    expect(call[1]).toContain("ksugawara61/diff-coverage");
    expect(call[1]).toContain("--state");
    expect(call[1]).toContain("open");
  });
});

describe("getPullRequest", () => {
  it("calls `gh pr view <number>` and returns the parsed PR", async () => {
    stubOk(
      JSON.stringify({
        baseRefName: "main",
        headRefName: "feature",
        headRefOid: "sha1",
        number: 12,
        state: "OPEN",
        url: "https://github.com/o/r/pull/12",
      }),
    );
    const pr = await getPullRequest({
      cwd: "/repo",
      owner: "o",
      pullNumber: 12,
      repo: "r",
    });
    expect(pr.number).toBe(12);
    const call = mockExeca.mock.calls[0];
    expect(call[1]).toContain("pr");
    expect(call[1]).toContain("view");
    expect(call[1]).toContain("12");
  });
});

describe("listReviewComments", () => {
  it("parses newline-delimited JSON lines from gh --paginate --jq", async () => {
    const lines = [
      JSON.stringify({
        body: "first",
        id: 1,
        line: 10,
        path: "src/a.ts",
        start_line: null,
      }),
      JSON.stringify({
        body: "second",
        id: 2,
        line: 20,
        path: "src/b.ts",
        start_line: 18,
      }),
      "",
    ].join("\n");
    stubOk(lines);

    const comments = await listReviewComments({
      cwd: "/repo",
      owner: "o",
      pullNumber: 1,
      repo: "r",
    });

    expect(comments).toHaveLength(2);
    expect(comments[0].body).toBe("first");
    expect(comments[1].start_line).toBe(18);
  });

  it("wraps gh api failures with command details", async () => {
    stubFail("not found");

    await expect(
      listReviewComments({
        cwd: "/repo",
        owner: "o",
        pullNumber: 404,
        repo: "r",
      }),
    ).rejects.toThrow(
      "gh api --paginate repos/o/r/pulls/404/comments --jq .[] | {id, path, line, start_line, side, start_side, body, html_url, pull_request_review_id, in_reply_to_id, created_at, updated_at, user: (.user | {login})} failed: not found",
    );
  });
});

describe("listReviewThreads", () => {
  it("parses paginated GraphQL review thread JSON lines", async () => {
    const lines = [
      JSON.stringify({
        comments: [
          {
            author: { login: "alice" },
            body: "thread comment",
            createdAt: "2026-05-12T00:00:00Z",
            id: 11,
            updatedAt: "2026-05-12T00:00:00Z",
          },
        ],
        id: "PRRT_1",
        isOutdated: false,
        isResolved: true,
        line: 10,
        path: "src/a.ts",
        startLine: null,
      }),
      "",
    ].join("\n");
    stubOk(lines);

    const threads = await listReviewThreads({
      cwd: "/repo",
      owner: "o",
      pullNumber: 17,
      repo: "r",
    });

    expect(threads).toEqual([
      {
        comments: [
          {
            author: { login: "alice" },
            body: "thread comment",
            createdAt: "2026-05-12T00:00:00Z",
            id: 11,
            updatedAt: "2026-05-12T00:00:00Z",
          },
        ],
        id: "PRRT_1",
        isOutdated: false,
        isResolved: true,
        line: 10,
        path: "src/a.ts",
        startLine: null,
      },
    ]);
    const call = mockExeca.mock.calls[0];
    expect(call[1]).toContain("graphql");
    expect(call[1]).toContain("--paginate");
    expect(call[1]).toContain("owner=o");
    expect(call[1]).toContain("repo=r");
    expect(call[1]).toContain("pullNumber=17");
  });
});

describe("createReview", () => {
  it("posts a JSON payload with event=COMMENT via stdin", async () => {
    stubOk(JSON.stringify({ html_url: "https://x/review/1", id: 99 }));

    const result = await createReview({
      body: "summary",
      comments: [
        {
          body: "uncovered",
          line: 12,
          path: "src/foo.ts",
          side: "RIGHT",
        },
      ],
      commitId: "deadbeef",
      cwd: "/repo",
      owner: "o",
      pullNumber: 5,
      repo: "r",
    });

    expect(result.id).toBe(99);
    const call = mockExeca.mock.calls[0];
    expect(call[1]).toContain("repos/o/r/pulls/5/reviews");
    const opts = call[2] as unknown as { input?: string };
    const payload = JSON.parse(opts.input ?? "{}") as {
      body: string;
      comments: { line: number; path: string }[];
      commit_id: string;
      event: string;
    };
    expect(payload.event).toBe("COMMENT");
    expect(payload.commit_id).toBe("deadbeef");
    expect(payload.body).toBe("summary");
    expect(payload.comments[0]).toMatchObject({
      line: 12,
      path: "src/foo.ts",
    });
  });
});

describe("listPullRequestReviews", () => {
  it("parses newline-delimited JSON from gh --paginate --jq", async () => {
    const lines = [
      JSON.stringify({
        body: "review body",
        html_url: "https://x/review/1",
        id: 10,
        state: "COMMENTED",
      }),
      "",
    ].join("\n");
    stubOk(lines);

    const reviews = await listPullRequestReviews({
      cwd: "/repo",
      owner: "o",
      pullNumber: 1,
      repo: "r",
    });

    expect(reviews).toHaveLength(1);
    expect(reviews[0].id).toBe(10);
    expect(reviews[0].state).toBe("COMMENTED");
  });
});

describe("updateReview", () => {
  it("sends PUT to reviews endpoint with body payload", async () => {
    stubOk(JSON.stringify({ html_url: "https://x/review/5", id: 5 }));

    const result = await updateReview({
      body: "updated summary",
      cwd: "/repo",
      owner: "o",
      pullNumber: 3,
      repo: "r",
      reviewId: 5,
    });

    expect(result.id).toBe(5);
    const call = mockExeca.mock.calls[0];
    expect(call[1]).toContain("repos/o/r/pulls/3/reviews/5");
    expect(call[1]).toContain("PUT");
    const opts = call[2] as unknown as { input?: string };
    expect(JSON.parse(opts.input ?? "{}")).toMatchObject({
      body: "updated summary",
    });
  });
});

describe("updateReviewComment", () => {
  it("sends PATCH to pulls/comments endpoint with body payload", async () => {
    stubOk("{}");

    await updateReviewComment({
      body: "new body",
      commentId: 99,
      cwd: "/repo",
      owner: "o",
      repo: "r",
    });

    const call = mockExeca.mock.calls[0];
    expect(call[1]).toContain("repos/o/r/pulls/comments/99");
    expect(call[1]).toContain("PATCH");
    const opts = call[2] as unknown as { input?: string };
    expect(JSON.parse(opts.input ?? "{}")).toMatchObject({ body: "new body" });
  });
});

describe("createReviewCommentSingle", () => {
  it("sends POST to pulls/comments with commit_id and comment fields", async () => {
    stubOk("{}");

    await createReviewCommentSingle({
      comment: { body: "uncovered", line: 5, path: "src/a.ts", side: "RIGHT" },
      commitId: "abc123",
      cwd: "/repo",
      owner: "o",
      pullNumber: 7,
      repo: "r",
    });

    const call = mockExeca.mock.calls[0];
    expect(call[1]).toContain("repos/o/r/pulls/7/comments");
    expect(call[1]).toContain("POST");
    const opts = call[2] as unknown as { input?: string };
    const payload = JSON.parse(opts.input ?? "{}") as Record<string, unknown>;
    expect(payload).toMatchObject({
      body: "uncovered",
      commit_id: "abc123",
      line: 5,
      path: "src/a.ts",
    });
  });
});
