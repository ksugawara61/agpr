#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/worktrees/remove-copilot.sh

Removes the current linked worktree when it lives under
.codex/worktrees/copilot/<name>, then moves back to the project root.
USAGE
}

case "${1:-}" in
  -h|--help)
    usage
    exit 0
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

if [[ "$(basename "${git_common_dir}")" != ".git" ]]; then
  echo "Cannot infer project root from git common dir: ${git_common_dir}" >&2
  exit 1
fi

project_root="$(cd "${git_common_dir}/.." && pwd -P)"
copilot_worktrees_dir="${project_root}/.codex/worktrees/copilot"
worktree_root="$(cd "${worktree_root}" && pwd -P)"

case "${worktree_root}" in
  "${copilot_worktrees_dir}"/*)
    ;;
  *)
    echo "Current linked worktree is not under: ${copilot_worktrees_dir}" >&2
    echo "Current worktree: ${worktree_root}" >&2
    exit 1
    ;;
esac

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
