import type { Command } from "commander";
import {
  type BranchReviewComments,
  getStructuredReviewCommentsByBranch,
} from "../../applications/review/get-structured-review-comments-by-branch.js";

type ReviewCommandOptions = {
  branch: string;
  cwd: string;
  repo: string;
};

type ReviewCommandOutput = {
  filePaths: {
    filePath: string;
    reviews: {
      comments: string[];
      endLine: number | null;
      startLine: number | null;
      threadId: string;
    }[];
  }[];
};

const parseRepoOption = (repo: string): { owner: string; repo: string } => {
  const [owner, repoName, ...rest] = repo.split("/");
  if (!owner || !repoName || rest.length > 0) {
    throw new Error(`--repo must be in owner/repo format: ${repo}`);
  }
  return { owner, repo: repoName };
};

const formatReviewCommandOutput = (
  result: BranchReviewComments | null,
): ReviewCommandOutput => ({
  filePaths:
    result?.files.map((file) => ({
      filePath: file.path,
      reviews: file.threads.map((thread) => ({
        comments: thread.comments.map((comment) => comment.body),
        endLine: thread.line,
        startLine: thread.startLine,
        threadId: String(thread.id),
      })),
    })) ?? [],
});

export const registerReviewCommand = (program: Command): void => {
  program
    .command("review")
    .description("Fetch structured PR review comments for a branch")
    .requiredOption("-b, --branch <branch>", "PR head branch name")
    .requiredOption("-R, --repo <owner/repo>", "GitHub repository")
    .option("--cwd <path>", "Working directory", process.cwd())
    .action(async (options: ReviewCommandOptions) => {
      const { owner, repo } = parseRepoOption(options.repo);
      const result = await getStructuredReviewCommentsByBranch({
        branch: options.branch,
        cwd: options.cwd,
        owner,
        repo,
      });
      console.log(JSON.stringify(formatReviewCommandOutput(result), null, 2));
    });
};
