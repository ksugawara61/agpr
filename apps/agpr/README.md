# @ksugawara61/agpr

A command line tool for streamlining GitHub pull request review workflows. It can fetch review comments in a structured format, reply to review threads, create draft pull requests from templates, and update pull request descriptions.

## Requirements

- Node.js
- GitHub CLI (`gh`)
- An authenticated GitHub CLI session

```sh
gh auth login
```

## Setup

Install and build from the monorepo root:

```sh
pnpm install
pnpm build
```

Run the built CLI locally:

```sh
node apps/agpr/dist/cli.js --help
```

If installed as a package:

```sh
agpr --help
```

## Commands

### `review` — Fetch review comments

Fetch structured pull request review comments for an open PR by head branch.

```sh
agpr review \
  --branch feature/example \
  --repo owner/repo \
  --format text
```

| Option | Description |
| --- | --- |
| `-b, --branch <branch>` | PR head branch name (required) |
| `-R, --repo <owner/repo>` | GitHub repository (required) |
| `--exclude-resolved` | Exclude resolved review threads |
| `--exclude-outdated` | Exclude outdated review threads |
| `-f, --format <json\|text>` | Output format (default: `json`) |
| `--cwd <path>` | Working directory |

### `review-reply` — Reply to review threads

Reply to one or more GitHub PR review threads.

```sh
agpr review-reply \
  --input '{"replies":[{"threadId":"PRRT_xxx","commitHashs":["abc123"],"message":"Fixed in this commit."}]}' \
  --format text
```

`--input` JSON fields:

| Field | Type | Description |
| --- | --- | --- |
| `threadId` | `string` | Review thread ID |
| `commitHashs` | `string[]` | Related commit hashes (at least one) |
| `message` | `string` | Reply message |

| Option | Description |
| --- | --- |
| `--input <json>` | JSON payload containing `replies` (required) |
| `-f, --format <json\|text>` | Output format (default: `json`) |
| `--cwd <path>` | Working directory |

### `create-draft-pr` — Create a draft pull request

Create a draft pull request with a generated description.

```sh
agpr create-draft-pr \
  --repo owner/repo \
  --input '{"title":"Add feature","background":"Explain why.","issueId":"#123","changes":["Add command","Add tests"],"headBranch":"feature/example","baseBranch":"main"}' \
  --template .github/pull_request_template.md
```

`--input` JSON fields:

| Field | Type | Description |
| --- | --- | --- |
| `title` | `string` | Pull request title |
| `background` | `string` | Background or reason for the change |
| `headBranch` | `string` | Source branch |
| `changes` | `string[]` | List of changes |
| `baseBranch` | `string` | Target branch (default: `main`) |
| `issueId` | `string` (optional) | Related issue or task ID |

| Option | Description |
| --- | --- |
| `-R, --repo <owner/repo>` | GitHub repository (required) |
| `--input <json>` | JSON payload for the PR (required) |
| `--template <path>` | Optional Markdown template file |
| `--copilot` | Request a GitHub Copilot review after creating the PR |
| `--cwd <path>` | Working directory |

### `update-pr` — Update a pull request description

Update an existing open pull request description by finding the PR from its head branch.

```sh
agpr update-pr \
  --repo owner/repo \
  --input '{"branchName":"feature/example","background":"Updated context.","issueId":"#123","changes":["Refine implementation","Update tests"]}' \
  --template .github/pull_request_template.md
```

`--input` JSON fields:

| Field | Type | Description |
| --- | --- | --- |
| `branchName` | `string` | Branch name used to find the open pull request |
| `background` | `string` | Background or reason for the change |
| `changes` | `string[]` | List of changes |
| `issueId` | `string` (optional) | Related issue or task ID |

| Option | Description |
| --- | --- |
| `-R, --repo <owner/repo>` | GitHub repository (required) |
| `--input <json>` | JSON payload for the PR description (required) |
| `--template <path>` | Optional Markdown template file |
| `--cwd <path>` | Working directory |

## Pull Request Templates

`create-draft-pr` and `update-pr` can render Markdown templates with double-brace placeholders:

```md
## Background

{{background}}

## Issue

{{issueId}}

## Changes

{{changes}}
```

| Placeholder | Description |
| --- | --- |
| `{{title}}` | Pull request title. Available for `create-draft-pr`. |
| `{{background}}` | Background or reason for the change. |
| `{{issueId}}` | Issue or task ID. Renders as `N/A` when omitted. |
| `{{changes}}` | Changes rendered as Markdown bullet points. |
| `{{headBranch}}` | Source branch. Available for `create-draft-pr`. |
| `{{baseBranch}}` | Target branch. Available for `create-draft-pr`. |
| `{{branchName}}` | Branch used to find the PR. Available for `update-pr`. |

Unknown placeholders are left unchanged.

## License

MIT
