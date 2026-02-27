#!/usr/bin/env bash
# .claude/hooks/enforce-bun.sh
# PreToolUse hook: blocks npm/npx commands and instructs the agent to use bun/bunx instead.

set -euo pipefail

INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')

# Nothing to check if there's no command
[ -z "$COMMAND" ] && exit 0

# Check if the command invokes npm or npx (as a standalone command, not as a substring of other words)
# Matches: npm, npx at word boundaries — covers "npm install", "npx create-react-app", "sudo npm ...", etc.
# Does not match: words containing npm/npx as a substring (e.g., variable names)
if echo "$COMMAND" | grep -qE '(^|[;&|() ])n(pm|px)( |$|[;&|])'; then
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
