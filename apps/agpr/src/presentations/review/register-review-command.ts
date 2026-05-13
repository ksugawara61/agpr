import { type Command, Option } from "commander";
import {
  type BranchReviewComments,
  getStructuredReviewCommentsByBranch,
} from "../../applications/review/get-structured-review-comments-by-branch.js";

type OutputFormat = "json" | "text";

type ReviewCommandOptions = {
  branch: string;
  cwd: string;
  excludeOutdated: boolean;
  excludeResolved: boolean;
  format: OutputFormat;
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
  message?: string;
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
  branch: string,
): ReviewCommandOutput => {
  if (result === null) {
    return {
      filePaths: [],
      message: `No open pull request found for branch: ${branch}.`,
    };
  }
  return {
    filePaths: result.files.map((file) => ({
      filePath: file.path,
      reviews: file.threads.map((thread) => ({
        comments: thread.comments.map((comment) => comment.body),
        endLine: thread.line,
        startLine: thread.startLine,
        threadId: String(thread.id),
      })),
    })),
  };
};

const formatLineRange = (
  startLine: number | null,
  endLine: number | null,
): string => {
  const start = startLine === null ? "null" : String(startLine);
  const end = endLine === null ? "null" : String(endLine);
  return `${start}-${end}`;
};

const formatTextReviewCommandOutput = (
  result: BranchReviewComments | null,
  branch: string,
): string => {
  if (result === null) {
    return `# Review Comments\n\nNo open pull request found for branch: ${branch}.`;
  }
  const output = formatReviewCommandOutput(result, branch);
  if (output.filePaths.length === 0) {
    return "# Review Comments\n\nNo review comments found.";
  }
  return [
    "# Review Comments",
    ...output.filePaths.map((file) =>
      [
        "",
        `## File: ${file.filePath}`,
        ...file.reviews.map((review) =>
          [
            "",
            `### Thread: ${review.threadId}`,
            `- Lines: ${formatLineRange(review.startLine, review.endLine)}`,
            "- Comments:",
            ...review.comments.map(
              (comment, index) => `${index + 1}. ${comment}`,
            ),
          ].join("\n"),
        ),
      ].join("\n"),
    ),
  ].join("\n");
};

const formatCommandOutput = (
  result: BranchReviewComments | null,
  branch: string,
  format: OutputFormat,
): string =>
  format === "json"
    ? JSON.stringify(formatReviewCommandOutput(result, branch), null, 2)
    : formatTextReviewCommandOutput(result, branch);

export const registerReviewCommand = (program: Command): void => {
  program
    .command("review")
    .description("Fetch structured PR review comments for a branch")
    .requiredOption("-b, --branch <branch>", "PR head branch name")
    .requiredOption("-R, --repo <owner/repo>", "GitHub repository")
    .option("--exclude-resolved", "Exclude resolved review threads", false)
    .option("--exclude-outdated", "Exclude outdated review threads", false)
    .addOption(
      new Option("-f, --format <format>", "Output format")
        .choices(["json", "text"])
        .default("json"),
    )
    .option("--cwd <path>", "Working directory", process.cwd())
    .action(async (options: ReviewCommandOptions) => {
      const { owner, repo } = parseRepoOption(options.repo);
      const result = await getStructuredReviewCommentsByBranch({
        branch: options.branch,
        cwd: options.cwd,
        excludeOutdated: options.excludeOutdated,
        excludeResolved: options.excludeResolved,
        owner,
        repo,
      });
      console.log(formatCommandOutput(result, options.branch, options.format));
    });
};
