#!/bin/bash
# Infinite headless Claude Code runner
# Usage: .claude/run.sh "your prompt here"
#   or:  .claude/run.sh  (uses default prompt)
set -o pipefail

PROMPT="${1:-Look at the plans in .claude/plans/ and the codebase, then figure out and implement the next steps. Document what you did and commit changes after each step.}"
ALLOWED_TOOLS='Bash(bun*),Bash(bunx*),Bash(timeout*),Bash(rm *),Edit,Write,Read,Glob,Grep,Task,WebFetch,WebSearch'

while true; do
  echo "=== Starting run at $(date) ==="
  claude -p "$PROMPT" --allowedTools "$ALLOWED_TOOLS"
  echo "=== Run complete at $(date) ==="
  sleep 5
done
