# @agpr/difflit

A command line tool that measures Vitest coverage only for files changed in a git diff. Instead of reporting coverage for the entire codebase, it focuses on the lines you actually touched.

## Requirements

- Node.js
- pnpm
- [Vitest](https://vitest.dev/) with `@vitest/coverage-v8` configured in the target project

## Setup

Install and build from the monorepo root:

```sh
pnpm install
pnpm build
```

Run the built CLI locally:

```sh
node apps/difflit/dist/cli.js --help
```

If installed as a package:

```sh
difflit --help
```

## Commands

### `measure` (default) — Measure diff coverage

Measure Vitest coverage for files changed between the current branch and a base branch.

```sh
difflit measure --base main
```

Because `measure` is the default command, it can also be invoked directly:

```sh
difflit --base main
```

#### Options

| Option | Description |
| --- | --- |
| `-b, --base <branch>` | Base branch for diff (default: merge-base of HEAD and `main`) |
| `-c, --cwd <path>` | Project root directory (default: current working directory) |
| `--cmd <command>` | Override the Vitest command (e.g. `pnpm vitest`) |
| `--ext <extensions>` | Comma-separated file extensions to consider (default: `ts,tsx,js,jsx`) |
| `--threshold <number>` | Exit with code 1 if line coverage falls below this percentage |
| `--json` | Output raw JSON instead of the formatted report |
| `--diff-only` | Only show changed files; skip running tests |
| `--exclude <patterns>` | Comma-separated glob patterns to exclude (e.g. `*.mocks.ts,src/fixtures/**`) |
| `--include <patterns>` | Comma-separated glob patterns to include (e.g. `src/**,packages/api/**`) |

#### Examples

Compare against `main` and fail if line coverage is below 80%:

```sh
difflit --base main --threshold 80
```

Show only changed files without running tests:

```sh
difflit --base main --diff-only
```

Output raw JSON for use in other tools:

```sh
difflit --base main --json
```

Override the test command and exclude fixture files:

```sh
difflit --base main --cmd "pnpm vitest" --exclude "src/fixtures/**,*.mocks.ts"
```

## Output

Default text output:

```
=== Diff Coverage Report (vitest) ===

Files changed: 3
Lines:      85.7% (12/14)
Statements: 83.3% (10/12)
Functions:  100% (4/4)
Branches:   75% (3/4)

Threshold: 80% -> PASS

--- Per File ---
✅ src/foo.ts
   Lines: 100%  Stmts: 100%  Fns: 100%  Branches: 100%
⚠️ src/bar.ts
   Lines: 66.7%  Stmts: 66.7%  Fns: 100%  Branches: 50%
   Uncovered lines: 12, 15
❌ src/baz.ts
   Lines: 40%  Stmts: 40%  Fns: 50%  Branches: 25%
   Uncovered lines: 8, 9, 10, 14
```

Coverage icons:
- ✅ ≥ 80%
- ⚠️ ≥ 50%
- ❌ < 50%

## Exit Codes

| Code | Meaning |
| --- | --- |
| `0` | Success (threshold met or no threshold set) |
| `1` | Line coverage is below `--threshold`, or an error occurred |

## License

MIT
