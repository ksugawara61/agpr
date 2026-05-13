# agpr

`agpr` is a command line tool for streamlining GitHub pull request review
workflows. It can fetch review comments in a structured format, reply to review
threads, create draft pull requests from templates, and update pull request
descriptions.

## Requirements

- Node.js
- pnpm
- GitHub CLI (`gh`)
- An authenticated GitHub CLI session

Authenticate with GitHub before using commands that read or write pull request
data:

```sh
gh auth login
```

## Setup

```sh
pnpm install
pnpm build
```

Run the built CLI locally:

```sh
node apps/agpr/dist/cli.js --help
```

If installed as a package, the binary name is:

```sh
agpr --help
```

## Commands

### Fetch review comments

Fetch structured pull request review comments for an open PR by head branch.

```sh
node apps/agpr/dist/cli.js review \
  --branch feature/example \
  --repo owner/repo \
  --format text
```

Options:

- `--branch <branch>`: PR head branch name.
- `--repo <owner/repo>`: GitHub repository.
- `--exclude-resolved`: Exclude resolved review threads.
- `--exclude-outdated`: Exclude outdated review threads.
- `--format <json|text>`: Output format. Defaults to `json`.
- `--cwd <path>`: Working directory.

### Reply to review threads

Reply to one or more GitHub PR review threads.

```sh
node apps/agpr/dist/cli.js review-reply \
  --input '{"replies":[{"threadId":"PRRT_xxx","commitHashs":["abc123"],"message":"Fixed in this commit."}]}' \
  --format text
```

Input fields:

- `threadId`: Review thread ID.
- `commitHashs`: Commit hashes related to the reply.
- `message`: Reply message.

Options:

- `--input <json>`: JSON payload containing `replies`.
- `--format <json|text>`: Output format. Defaults to `json`.
- `--cwd <path>`: Working directory.

### Create a draft pull request

Create a draft pull request with a generated description.

```sh
node apps/agpr/dist/cli.js create-draft-pr \
  --repo owner/repo \
  --input '{"title":"Add feature","background":"Explain why this change is needed.","issueId":"#123","changes":["Add command","Add tests"],"headBranch":"feature/example","baseBranch":"main"}' \
  --template .github/pull_request_template.md
```

Input fields:

- `title`: Pull request title.
- `background`: Background or reason for the change.
- `issueId`: Optional GitHub issue ID or task ID.
- `changes`: List of changes.
- `headBranch`: Source branch.
- `baseBranch`: Target branch. Defaults to `main`.

Options:

- `--repo <owner/repo>`: GitHub repository.
- `--input <json>`: JSON payload for the PR.
- `--template <path>`: Optional Markdown template file.
- `--copilot`: Request a GitHub Copilot review after creating the PR.
- `--cwd <path>`: Working directory.

### Update a pull request description

Update an existing open pull request description by finding the PR from its head
branch.

```sh
node apps/agpr/dist/cli.js update-pr \
  --repo owner/repo \
  --input '{"branchName":"feature/example","background":"Updated context.","issueId":"#123","changes":["Refine implementation","Update tests"]}' \
  --template .github/pull_request_template.md
```

Input fields:

- `branchName`: Branch name used to find the open pull request.
- `background`: Background or reason for the change.
- `issueId`: Optional GitHub issue ID or task ID.
- `changes`: List of changes.

Options:

- `--repo <owner/repo>`: GitHub repository.
- `--input <json>`: JSON payload for the PR description.
- `--template <path>`: Optional Markdown template file.
- `--cwd <path>`: Working directory.

## Pull Request Templates

`create-draft-pr` and `update-pr` can render Markdown templates with
double-brace placeholders:

```md
## Background

{{background}}

## Issue

{{issueId}}

## Changes

{{changes}}
```

Supported placeholders:

- `{{title}}`: Pull request title. Available for `create-draft-pr`.
- `{{background}}`: Background or reason for the change.
- `{{issueId}}`: Issue or task ID. Renders as `N/A` when omitted.
- `{{changes}}`: Changes rendered as Markdown bullet points.
- `{{headBranch}}`: Source branch. Available for `create-draft-pr`.
- `{{baseBranch}}`: Target branch. Available for `create-draft-pr`.
- `{{branchName}}`: Branch used to find the PR. Available for `update-pr`.

Unknown placeholders are left unchanged.

## Development

Project layout:

- `apps/agpr`: CLI application package.
- `packages/repositories`: reusable repository adapters used by the CLI.

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm coverage
pnpm knip
```

## License

MIT
