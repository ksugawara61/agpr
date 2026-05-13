#!/bin/bash
# .claude/hooks/block-npx.sh
COMMAND=$(jq -r '.tool_input.command')

if echo "$COMMAND" | grep -q 'npx' && ! echo "$COMMAND" | grep -q '@ksugawara61/agpr'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "Destructive command blocked by hook"
    }
  }'
else
  exit 0  # allow the command
fi
