#!/usr/bin/env bash
# .claude/hooks/enforce-bun.sh
# PreToolUse hook: blocks npm/npx commands and instructs the agent to use bun/bunx instead.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Nothing to check if there's no command
[ -z "$COMMAND" ] && exit 0

# Strip quoted strings so that references inside commit messages, echo, etc. don't trigger false positives.
# e.g. git commit -m "use bun instead of npm" → git commit -m  → no match
STRIPPED=$(echo "$COMMAND" | sed -E "s/\"[^\"]*\"//g; s/'[^']*'//g")

# Check if the command invokes npm or npx as an actual command (not inside a quoted string)
if echo "$STRIPPED" | grep -qE '(^|[;&|() ])n(pm|px)( |$|[;&|])'; then
  jq -n '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: "npm/npx is not allowed in this project. Use bun instead of npm and bunx instead of npx. For example: bun install, bun run <script>, bunx <package>."
    }
  }'
else
  exit 0
fi
