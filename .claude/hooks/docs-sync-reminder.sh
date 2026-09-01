#!/bin/bash
# PreToolUse(Bash) hook: commit-time reminders for numux's documented surfaces.
#
# Several README and CLAUDE.md sections mirror user-facing source or repository
# tooling. When a commit touches a source without its mirror, inject a specific
# reminder so the agent reviews the documentation before committing. Conditional
# by design: ordinary commits stay silent, so a fired reminder remains useful.
#
# Advisory only — this hook must NEVER emit a permissionDecision. An "allow"
# decision would auto-approve the entire matching Bash command, including compound
# commands with arbitrary tails. additionalContext leaves the user's normal
# permission flow unchanged.
command -v jq >/dev/null 2>&1 || exit 0
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // ""')

# Match an actual `git commit` invocation (including `git add -A && git commit`),
# not a command that merely mentions both words (`git log | grep commit`).
[[ "$COMMAND" =~ (^|[\;\&\|[:space:]])git([[:space:]]+-[^[:space:]]+)*[[:space:]]+commit([[:space:]]|$) ]] || exit 0

# Staging commonly happens in the same compound command, so the index can still
# be empty at PreToolUse time. Read the complete dirty set; -uall prevents new
# files inside untracked directories from being collapsed out of the path checks.
DIRTY=$(git status --porcelain -uall 2>/dev/null)
[ -n "$DIRTY" ] || exit 0

BULLETS=""
# rule <trigger regex on dirty paths> <suppress regex (mirror already touched)> <bullet>
rule() {
	echo "$DIRTY" | grep -qE "$1" || return 0
	echo "$DIRTY" | grep -qE "$2" && return 0
	BULLETS="${BULLETS}- $3"$'\n'
}

rule 'src/cli(-flags)?\.ts' 'README\.md$' \
	'CLI definitions or parsing changed without README.md. Run `bun run docs` for the generated Options/Subcommands blocks, then review the surrounding usage and examples for behavior the tables do not explain.'

rule 'src/completions\.ts' 'README\.md$' \
	'Shell completion behavior changed without README.md. Check the supported-shell list and the Bash/Zsh/Fish setup commands as well as any affected CLI usage.'

rule 'src/(config|types)\.ts|src/config/(expand-scripts|interpolate|loader|platform|resolver|validator|workspaces)\.ts|src/process/(error|manager|ready|runner)\.ts|src/utils/(env-file|watcher)\.ts' 'README\.md$' \
	'Config or process-lifecycle behavior changed without README.md. Run `bun run docs` for the generated option tables and review the hand-written Config reference sections: script/workspace expansion, watching, interpolation, conditional/optional processes, dependency orchestration, and output capture.'

rule 'src/ui/(app|keybindings|search|url-handler)\.ts' 'README\.md$' \
	'TUI input or keybinding behavior changed without README.md. Run `bun run docs` for the generated Keybindings table and review the hand-written search-mode keys and surrounding interaction notes.'

rule 'src/ui/tabs\.ts' 'README\.md$' \
	'Tab status/icon logic changed without README.md. Run `bun run docs` and verify the generated Tab icons table still describes every visible status.'

rule '^.. package\.json$|^.. commitlint\.config\.ts$|\.github/workflows/|\.githooks/|\.claude/hooks/|^.. \.claude/(settings\.json|run\.sh)$' 'CLAUDE\.md$' \
	'Repository commands, commit enforcement, CI, or Claude hooks changed without CLAUDE.md. If scripts, checks, hook behavior, or the headless workflow changed (not merely dependencies), update the Commands / Commits / CI / Hooks sections.'

[ -n "$BULLETS" ] || exit 0

MSG="STOP — commit-time documentation checks fired:
${BULLETS}If any item reflects a user-facing or workflow change, abort this commit, update and stage the relevant docs, then commit everything together. Proceed only when the docs are already accurate, including updates made earlier on this branch."

jq -n --arg msg "$MSG" '{
	"hookSpecificOutput": {
		"hookEventName": "PreToolUse",
		"additionalContext": $msg
	}
}'
