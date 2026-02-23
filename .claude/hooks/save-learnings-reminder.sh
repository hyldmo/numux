#!/bin/bash
# Workaround for hookify warn rules not injecting additionalContext (LLM never sees systemMessage).
# https://github.com/anthropics/claude-code/issues/20747
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

if [[ "$COMMAND" =~ git.*commit ]]; then
	jq -n --arg msg "REMINDER: Before committing, check if there are learnings worth saving to memory files or CLAUDE.md. Consider: mistakes made, patterns discovered, user preferences, codebase gotchas, new features to document, or refactors that invalidate docs. To confirm you have read this, add 'Learnings considered.' to your commit confirmation message." '{
		"hookSpecificOutput": {
			"hookEventName": "PreToolUse",
			"permissionDecision": "allow",
			"additionalContext": $msg
		}
	}'
fi
