#!/bin/bash
# Workaround for hookify warn rules not injecting additionalContext (LLM never sees systemMessage).
# https://github.com/anthropics/claude-code/issues/20747
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

MSG="REMINDER: Before committing, check if updated or new features
should be documented in README.md or CLAUDE.md.

Consider:
- New CLI flags
- Changed behavior
- New config options
- Refactors that invalidate docs

To confirm you have read this, add 'Learnings considered.'
to your commit confirmation message."

if [[ "$COMMAND" =~ git.*commit ]]; then
	jq -n --arg msg "$MSG" '{
		"hookSpecificOutput": {
			"hookEventName": "PreToolUse",
			"permissionDecision": "allow",
			"additionalContext": $msg
		}
	}'
fi
