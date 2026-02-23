---
name: block-force-delete
enabled: true
event: bash
pattern: rm\s+.*-[^\s]*f
action: block
---

**Blocked: Force flag (-f) on rm command**

Do not use the force flag when deleting files. Use `rm` without `-f` so the user can see and confirm any warnings.
