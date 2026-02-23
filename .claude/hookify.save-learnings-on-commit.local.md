---
name: save-learnings-on-commit
enabled: true
event: bash
pattern: git\s+commit
action: warn
---

**Remember to save session learnings!**

Before committing, check if there are any key learnings from this session worth saving to the Claude memory file or `CLAUDE.md`

Consider:
- Mistakes made and their root causes
- New patterns or techniques discovered
- User preferences learned
- Codebase-specific gotchas encountered
- New features that should be documented
- Refactors that makes the old docs out of date

To confirm you've read this, add "Learnings considered." to your commit confirmation message.
