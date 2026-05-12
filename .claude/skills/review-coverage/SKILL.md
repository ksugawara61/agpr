---
description: Measure diff coverage for the current PR and post inline review comments on GitHub. Uses `npx diff-coverage review` which handles coverage measurement, comment formatting, and GitHub posting in one step. Use during code review to surface coverage gaps without writing any tests.
metadata:
    github-path: skills/review-coverage
    github-ref: refs/heads/main
    github-repo: https://github.com/ksugawara61/diff-coverage
    github-tree-sha: f844cfeeb42e254bc2cfb062f7f4f12a5ead0425
name: review-coverage
---
# review-coverage

Measures test coverage for lines changed in the current PR and posts inline review comments on GitHub. This skill is read-only — it never writes or modifies test files.

## Prerequisites

- `npx diff-coverage` must be available.
- `gh` CLI must be authenticated (`gh auth status`).
- The current branch must have an open PR on GitHub.

## Workflow

### Step 1 — (Optional) Dry-run preview

Before posting, run with `--dry-run` to preview the planned inline comments without sending anything to GitHub:

```bash
npx diff-coverage review \
  [--threshold <number>] \
  [--include "<glob-patterns>"] \
  [--exclude "<glob-patterns>"] \
  --dry-run
```

Review the planned comments in stdout. If the output looks correct, proceed to Step 2.

### Step 2 — Post the review

Run without `--dry-run` to measure coverage and post inline comments to the PR:

```bash
npx diff-coverage review \
  [--threshold <number>] \
  [--include "<glob-patterns>"] \
  [--exclude "<glob-patterns>"]
```

| Option | Default | Purpose |
|--------|---------|---------|
| `--threshold <number>` | — | Minimum line coverage %; exits 1 if below |
| `--include <patterns>` | — | Comma-separated glob patterns to include |
| `--exclude <patterns>` | — | Comma-separated glob patterns to exclude |

The command will:

1. Detect the runner (Jest or Vitest) unless `--runner` is specified
2. Run the test suite with coverage scoped to the diff'd files
3. Correlate uncovered lines with the lines added in the PR
4. Post an inline review comment for each uncovered line range (idempotent — updates existing comments instead of duplicating)
5. Exit with code 1 if `--threshold` is set and coverage falls below it

### Step 3 — Report to user

Read the stdout output and summarize:

- PR number and URL
- Overall line coverage percentage
- Threshold status (pass/fail) if `--threshold` was specified
- Number of inline comments posted, updated, and skipped
- Link to the posted review (`postedReviewUrl`)

If the command exits with code 1 due to threshold failure, report which files are below the threshold and suggest running `/fix-coverage` to add missing tests.

## Constraints

- **Never modify any source or test files.** This skill is strictly read-only.
- **Do not change test configuration files** (`jest.config.*`, `vitest.config.*`, `package.json`).
- **Do not install packages.** Work only with dependencies already present.
- **Only report lines that are in the diff.** Unchanged lines are out of scope.
