---
description: Automatically improve test coverage for lines changed in a git diff. Reads uncovered source lines, writes or extends test files to cover them, then verifies tests pass and coverage improved. Use when you want to raise coverage on changed files without manually writing test cases.
metadata:
    github-path: skills/fix-coverage
    github-ref: refs/heads/main
    github-repo: https://github.com/ksugawara61/diff-coverage
    github-tree-sha: d75981853851415612f23585f8fb1dac9d4b973a
name: fix-coverage
---
# fix-coverage

Reads the diff-coverage report for changed files, identifies uncovered lines in source code, and writes targeted test cases to cover them. Iterates until coverage is satisfactory or no further improvement is possible.

## Prerequisites

The `diff-coverage` package must be available via `npx diff-coverage`.

## Invocation

```bash
npx diff-coverage <command> [options]
```

## Workflow

### Step 1 — Measure current coverage

Run `measure` to get the baseline report. Adjust options to match the project:

```bash
npx diff-coverage measure \
  [--include "<glob-patterns>"] \
  [--exclude "<glob-patterns>"] \
  [--cmd "<test-command>"] \
  [--threshold <number>]
```

| Option | Purpose |
|--------|---------|
| `--include` | Comma-separated globs to measure (e.g. source directories) |
| `--exclude` | Comma-separated globs to skip (e.g. mocks, stories) |
| `--cmd` | Custom test command; defaults to auto-detected runner |
| `--threshold` | Minimum coverage %; exit code 1 if any file falls below |

Parse the output to collect, for each changed file:

- The file path
- The uncovered line numbers listed under "Uncovered lines:"
- The current line coverage percentage

If all files already show 100% line coverage, report success immediately and stop.

### Step 2 — Understand the source code

For each file that has uncovered lines:

1. Read the source file to understand what the uncovered lines do (what functions, branches, or error paths they implement).
2. Locate the corresponding test file. Check in order:
   - Same directory, filename `<basename>.test.<ext>` or `<basename>.spec.<ext>`
   - A `__tests__/` sibling directory with the same filename pattern
3. If a test file exists, read it to understand the existing test structure, naming conventions, mocking patterns, and import style (ESM `import` vs CJS `require`).

### Step 3 — Write targeted tests

For each source file with uncovered lines, add only the tests needed to cover those lines. Do not rewrite existing tests.

**If a test file already exists:** Use Edit to add new `describe` blocks or `it`/`test` cases inside the existing file.

**If no test file exists:** Use Write to create one, placing it in the same directory as the source file (co-location pattern). Mirror the import style of other test files in the project.

**Guidelines for test quality:**

- Match the existing test framework (Jest or Vitest — check the runner reported by `measure`)
- For Vitest projects, include `import { describe, expect, it } from "vitest"` if other test files do
- For Jest projects, do not add framework imports (Jest globals are injected)
- Follow the naming convention: `describe` names the unit under test, `it`/`test` describes the behavior
- Use `it.each` for multiple similar inputs/outputs
- Test error paths using `expect(() => fn()).toThrow(...)` or `await expect(promise).rejects.toThrow(...)`
- Do not import or call any source file other than the one being tested
- Do not modify source files

### Step 4 — Verify tests pass

Run the test suite scoped to the files you modified. Use whatever test command the project provides (e.g. `pnpm test`, `npm test`, `npx vitest run`):

```bash
<test-command> <test-file-path> --no-coverage
```

If any tests fail, read the failure output, correct the test cases, and re-run. Do not proceed until all tests pass.

### Step 5 — Re-measure coverage

Run `measure` again with the same arguments as Step 2:

```bash
npx diff-coverage measure \
  [--include "<glob-patterns>"] \
  [--exclude "<glob-patterns>"] \
  [--cmd "<test-command>"] \
  [--threshold <number>]
```

Compare the new per-file percentages to the baseline from Step 2.

### Step 6 — Iterate or conclude

- If uncovered lines remain and coverage improved since the last iteration, return to Step 3 for the still-uncovered files.
- If coverage did not improve between iterations (the same lines are still uncovered after an attempt), explain why those lines are difficult or impossible to cover (e.g., unreachable dead code, platform-specific branches, third-party code paths) and stop.
- If all changed files reach 100% line coverage, or if `--threshold` was specified and all files now meet it, report success.

## Constraints

- **Never modify source files.** Only files matching `*.test.ts`, `*.test.tsx`, `*.spec.ts`, `*.spec.tsx`, `*.test.js`, `*.test.jsx`, `*.test.mts`, `*.spec.mts` may be written or edited.
- **Never rewrite an entire existing test file.** Always preserve existing tests; only append new cases.
- **Do not change test configuration files** (`jest.config.*`, `vitest.config.*`, `package.json`).
- **Do not install packages.** Work only with the dependencies already present in the project.
- **Only cover lines that are in the diff.** Do not add tests for lines that were not changed — they are out of scope for this skill.

## Output

After completing all iterations, report:

1. A summary of which files had tests added or extended
2. The before/after coverage percentages for each file
3. Any lines that remain uncovered and why (if applicable)
4. Confirmation that all new tests pass
