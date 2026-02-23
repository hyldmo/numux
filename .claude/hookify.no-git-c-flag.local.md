---
name: no-git-c-flag
enabled: true
event: bash
pattern: git\s+-C\s+
action: block
---

Do not use `git -C <folder>`. You are already in the correct working directory. Run git commands without the `-C` flag.
