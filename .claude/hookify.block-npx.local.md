---
name: block-npx
enabled: true
event: bash
pattern: \bnpx\s+
action: block
---

**Blocked: Use bun instead of npx**

This project uses Bun. Do not use `npx` to run packages.

**Use instead:**
- **Workspace script:** `bun run <script>` (e.g. `bun run typecheck`, `bun run lint`)
- **One-off package:** `bunx <package>` (equivalent to `npx` for packages not in the workspace)

Always prefer the workspace-installed version of a package over downloading it fresh.
