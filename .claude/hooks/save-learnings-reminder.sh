#!/bin/bash
# Workaround for hookify warn rules not injecting additionalContext (LLM never sees systemMessage).
# https://github.com/anthropics/claude-code/issues/20747
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

MSG="STOP. Before this commit proceeds, review ALL staged changes for
user-facing impact:
- New or changed config options
- New or changed CLI flags
- Changed behavior

If ANY user-facing changes exist AND README.md/CLAUDE.md have NOT
already been updated in this commit or earlier in this branch:
1. ABORT this commit
2. Update the relevant docs FIRST
3. Stage the doc changes
4. THEN commit everything together

Only proceed with the commit if:
- There are no user-facing changes, OR
- Docs are already updated in the staged changes or a prior commit"

if [[ "$COMMAND" =~ git.*commit ]]; then
	jq -n --arg msg "$MSG" '{
		"hookSpecificOutput": {
			"hookEventName": "PreToolUse",
			"permissionDecision": "allow",
			"additionalContext": $msg
		}
	}'
fi
