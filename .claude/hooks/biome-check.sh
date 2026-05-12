#!/bin/bash

# Read JSON input from stdin
input=$(cat)

# Extract file path from tool_input
file_path=$(echo "$input" | jq -r '.tool_input.file_path // empty')

# Exit if no file path
if [ -z "$file_path" ]; then
  exit 0
fi

# Check if the file matches the pattern (js, mjs, ts, mts, jsx, tsx, json, grit)
if [[ "$file_path" =~ \.(js|mjs|ts|mts|jsx|tsx|json|grit)$ ]]; then
  # Run biome check on the file
  cd "$CLAUDE_PROJECT_DIR"
  pnpm biome check --no-errors-on-unmatched --files-ignore-unknown=true --write "$file_path" 2>&1
fi

exit 0
