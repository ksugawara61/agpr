#!/usr/bin/env bash
set -euo pipefail

if [[ "${CI:-}" == "true" ]]; then
  exit 0
fi

git_dir="$(git rev-parse --path-format=absolute --git-dir)"
git_common_dir="$(git rev-parse --path-format=absolute --git-common-dir)"

git_dir="$(cd "${git_dir}" && pwd -P)"
git_common_dir="$(cd "${git_common_dir}" && pwd -P)"

if [[ "${git_dir}" == "${git_common_dir}" ]]; then
  lefthook install
  exit 0
fi

hooks_dir="${git_dir}/hooks"

mkdir -p "${hooks_dir}"
git config extensions.worktreeConfig true
git config --worktree core.hooksPath "${hooks_dir}"
lefthook install --force
