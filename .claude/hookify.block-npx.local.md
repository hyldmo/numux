---
name: block-npx
enabled: true
event: bash
pattern: \bnpx\s+
action: block
---

**Blocked: Use yarn instead of npx**

This project uses Yarn 4. Do not use `npx` to run packages.

**Use instead:**
- **Workspace script:** `yarn <script>` (e.g. `yarn biome`, `yarn wrangler`, `yarn drizzle-kit`)
- **One-off package:** `yarn dlx <package>` (equivalent to `npx` for packages not in the workspace)

Always prefer the workspace-installed version of a package over downloading it fresh.
