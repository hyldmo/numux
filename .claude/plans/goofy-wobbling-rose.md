# Plan: `workspaces` field for process configs

## Context

Monorepo users currently resort to clunky patterns like `"cd apps/image-worker && npm run validate"` to run commands in specific workspaces. The existing `-w` CLI flag runs a script across ALL workspaces but isn't available in config files. This feature adds a `workspaces` field to process configs that handles both cases declaratively.

## Design

`workspaces?: boolean | string | string[]` on `NumuxProcessConfig`:

- **`workspaces: true`** — template that expands into one process per workspace. Filters by script availability when command matches a PM run pattern (`npm run lint` → only workspaces with `lint` script). Raw commands (`eslint .`) run in all workspaces.
- **`workspaces: '@repo/image-worker'`** — single workspace, expands into one process with cwd set to that workspace's directory.
- **`workspaces: ['@repo/api', '@repo/web']`** — multiple specific workspaces, expands into one process per listed workspace.

All string forms resolve by package name first (with/without scope), falling back to relative path.

All forms expand into `{name}:{wsName}` processes (even single workspace, for consistency). The template process itself is replaced.

```ts
// Expands to lint:api, lint:web, lint:core, etc.
lint: { workspaces: true, command: 'npm run lint' }

// Expands to validate:image-worker
validate: { workspaces: '@repo/image-worker', command: 'npm run validate' }

// Expands to dev:api, dev:web
dev: { workspaces: ['@repo/api', '@repo/web'], command: 'npm run dev' }
```

## Steps

### 1. Types (`src/types.ts`)
- Add `workspaces?: boolean | string | string[]` to `NumuxProcessConfig`
- Update `ResolvedProcessConfig` to `Omit<NumuxProcessConfig, 'dependsOn' | 'workspaces'>`

### 2. Core logic (`src/config/workspaces.ts`)

**Extract shared helper** from existing `resolveWorkspaceProcesses`:
```ts
interface WorkspaceInfo {
  dir: string
  name: string        // scope-stripped pkg.name or dir basename
  pkgName?: string    // raw pkg.name
  scripts: Record<string, string>
}
function discoverWorkspaces(cwd: string): WorkspaceInfo[]
```

**Add `findWorkspace(nameOrPath, workspaces)`**: finds a specific workspace by matching pkg.name (full or scope-stripped) then falling back to relative path.

**Add `extractScriptFromCommand`**: matches `(npm|yarn|pnpm|bun) run <script>` patterns, returns script name or null.

**Add `expandWorkspaces(config: NumuxConfig): NumuxConfig`**:
- Iterates processes, passes non-workspaces entries through
- `workspaces: true`: discovers all workspaces, filters by script if detectable, creates `{name}:{wsName}` entries inheriting all template config
- `workspaces: 'str'` or `['str', ...]`: resolves each named workspace, creates `{name}:{wsName}` entries
- Validates: no `workspaces`+`cwd` conflict, workspaces entries require `command`, listed workspaces must exist
- Strips `workspaces` field from output

**Refactor `resolveWorkspaceProcesses`** to use `discoverWorkspaces` (keeps backward compat for `-w` CLI).

### 3. Pipeline integration (`src/index.ts`)

Insert `expandWorkspaces()` between `expandScriptPatterns()` and `validateConfig()` at three locations:
- Config-file path (line ~197)
- Validate subcommand (line ~79)
- Exec subcommand (line ~119)

### 4. Tests (`src/config/workspaces.test.ts`)

Key test cases:
- `workspaces: true` expands to per-workspace processes with correct names
- `workspaces: true` filters by script availability
- `workspaces: true` with raw command includes all workspaces
- `workspaces: true` inherits template config (env, dependsOn, color, etc.)
- `workspaces: 'name'` expands to single `{name}:{wsName}` process
- `workspaces: ['a', 'b']` expands to multiple processes
- Resolution by package name (with and without scope)
- Resolution by relative path fallback
- `workspaces: 'nonexistent'` throws with available workspace list
- `workspaces` + `cwd` conflict throws
- `workspaces: true` without command throws
- Name deduplication for collisions
- `extractScriptFromCommand` unit tests
- Non-workspace processes pass through unchanged

## Error messages

| Scenario | Message |
|---|---|
| `workspaces` + no command | `Process "X": workspaces requires a "command"` |
| `workspaces` + `cwd` both set | `Process "X": cannot set both "workspaces" and "cwd"` |
| workspace not found | `Process "X": workspace "foo" not found. Available: api, web, core` |
| no workspaces match script | `Process "X": no workspaces have a "lint" script` |
| no workspaces found at all | `Process "X": no workspaces found` |

## Files

- `src/types.ts` — add field, update omit
- `src/config/workspaces.ts` — `expandWorkspaces()`, `discoverWorkspaces()`, `findWorkspace()`, `extractScriptFromCommand()`, refactor existing
- `src/index.ts` — wire into pipeline (3 locations)
- `src/config/workspaces.test.ts` — new test block

## Verification

1. `bun run typecheck` — no type errors
2. `bun test` — all existing + new tests pass
3. `bun run lint` — no lint issues
4. Manual: create a test monorepo config with `workspaces: true`, `workspaces: 'name'`, and `workspaces: [...]`, run `numux validate` to verify expansion
