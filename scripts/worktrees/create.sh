#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'USAGE'
Usage: scripts/worktrees/create.sh <codex|copilot> <name> [tool-args...]

Creates a git worktree at .worktrees/<tool>/<name>, copies paths
listed in .worktreeinclude, installs dependencies, starts the selected tool,
and removes the worktree after the tool exits.
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

if [[ $# -lt 2 ]]; then
  usage >&2
  exit 1
fi

tool="${1}"
shift

case "${tool}" in
  codex|copilot)
    ;;
  *)
    fail_invalid_tool "${tool}"
    ;;
esac

worktree_name="${1}"
shift

repo_root="$(git rev-parse --show-toplevel)"
branch_name="${tool}/${worktree_name}"
worktree_dir="${repo_root}/.worktrees/${tool}/${worktree_name}"
include_file="${repo_root}/.worktreeinclude"

git check-ref-format --branch "${branch_name}" >/dev/null

if [[ -e "${worktree_dir}" ]]; then
  echo "Worktree path already exists: ${worktree_dir}" >&2
  exit 1
fi

mkdir -p "$(dirname "${worktree_dir}")"
git -C "${repo_root}" worktree add -b "${branch_name}" "${worktree_dir}"

if [[ -f "${include_file}" ]]; then
  while IFS= read -r include_path || [[ -n "${include_path}" ]]; do
    include_path="${include_path%$'\r'}"

    case "${include_path}" in
      ""|\#*)
        continue
        ;;
    esac

    source_path="${repo_root}/${include_path}"
    target_path="${worktree_dir}/${include_path}"

    if [[ ! -e "${source_path}" && ! -L "${source_path}" ]]; then
      echo "Skipping missing .worktreeinclude path: ${include_path}" >&2
      continue
    fi

    mkdir -p "$(dirname "${target_path}")"

    if [[ -d "${source_path}" ]]; then
      mkdir -p "${target_path}"
      cp -pR "${source_path}/." "${target_path}/"
    else
      cp -p "${source_path}" "${target_path}"
    fi
  done <"${include_file}"
fi

cd "${worktree_dir}"
pnpm install

tool_status=0
case "${tool}" in
  codex)
    codex --sandbox workspace-write --add-dir "${worktree_dir}" "$@" || tool_status=$?
    ;;
  copilot)
    copilot --add-dir "${worktree_dir}" "$@" || tool_status=$?
    ;;
esac

remove_status=0
"${repo_root}/scripts/worktrees/remove.sh" "${tool}" || remove_status=$?

if [[ "${tool_status}" -ne 0 ]]; then
  exit "${tool_status}"
fi

exit "${remove_status}"
