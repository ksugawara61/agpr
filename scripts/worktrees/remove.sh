#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/worktrees/remove.sh <codex|copilot>

Removes the current linked worktree when it lives under
.worktrees/<tool>/<name>, then moves back to the project root.
USAGE
}

fail_invalid_tool() {
  echo "Unsupported tool: ${1}" >&2
  echo "Expected one of: codex, copilot" >&2
  exit 1
}

if [[ $# -eq 0 ]]; then
  usage >&2
  exit 1
fi

case "${1}" in
  -h|--help)
    usage
    exit 0
    ;;
esac

if [[ $# -ne 1 ]]; then
  usage >&2
  exit 1
fi

tool="${1}"

case "${tool}" in
  codex|copilot)
    ;;
  *)
    fail_invalid_tool "${tool}"
    ;;
esac

worktree_root="$(git rev-parse --show-toplevel)"
git_dir="$(git rev-parse --path-format=absolute --git-dir)"
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"

git_dir="$(cd "${git_dir}" && pwd -P)"
git_common_dir="$(cd "${git_common_dir}" && pwd -P)"

if [[ "${git_dir}" == "${git_common_dir}" ]]; then
  echo "Not in a linked worktree. Refusing to remove the main worktree." >&2
  exit 1
fi

worktree_root="$(cd "${worktree_root}" && pwd -P)"
worktrees_marker="/.worktrees/${tool}/"

case "${worktree_root}" in
  *"${worktrees_marker}"*)
    ;;
  *)
    echo "Current linked worktree is not under a .worktrees/${tool} directory." >&2
    echo "Current worktree: ${worktree_root}" >&2
    exit 1
    ;;
esac

project_root="${worktree_root%%"${worktrees_marker}"*}"

if [[ -z "${project_root}" || ! -d "${project_root}" ]]; then
  echo "Cannot infer project root from worktree path: ${worktree_root}" >&2
  exit 1
fi

cd "${worktree_root}"
git worktree remove .

cd "${project_root}"

if [[ -d "${worktree_root}" ]]; then
  rmdir "${worktree_root}" 2>/dev/null || {
    echo "Worktree directory still exists and is not empty: ${worktree_root}" >&2
    exit 1
  }
fi

echo "Removed worktree: ${worktree_root}"
echo "Project root: ${project_root}"
