# numux — Terminal Multiplexer with Dependency Orchestration

## Context

numux is a general-purpose terminal multiplexer CLI (like SST's `sst dev` tmux UI but decoupled from SST infrastructure). It runs multiple processes in a tabbed TUI with clickable tabs, per-process output panes, and a dependency graph that controls startup order. A process can declare it depends on another, and optionally wait for a specific output pattern (e.g. "listening on port 3000") before dependents start.

The previous plan targeted Node.js with prefixed console output. This plan replaces it with a full TUI using OpenTUI (which requires Bun as runtime).

## Tech Stack

| Concern | Choice |
|---------|--------|
| Runtime + pkg manager | **Bun** (required by OpenTUI) |
| TUI framework | `@opentui/core` (vanilla TS imperative API) |
| Terminal emulation | `ghostty-opentui` (VT emulation for process output) |
| Process spawning | `Bun.spawn` with `terminal` option (native PTY) |
| Linting/formatting | Biome (existing `biome.jsonc`) |

## Config Format

Config lives in `numux.config.ts`, `numux.config.json`, or `package.json` under `"numux"` key.

```ts
// numux.config.ts
export default {
  processes: {
    db: {
      command: 'docker compose up postgres',
      readyPattern: 'ready to accept connections',
    },
    migrate: {
      command: 'bun run migrate',
      dependsOn: ['db'],
      persistent: false, // runs once, exit 0 = ready
    },
    api: {
      command: 'bun run dev:api',
      dependsOn: ['migrate'],
      readyPattern: 'listening on port 3000',
    },
    web: {
      command: 'bun run dev:web',
      dependsOn: ['api'],
    },
  },
}
```

## File Structure

```
src/
├── index.ts              # CLI entry point (shebang: #!/usr/bin/env bun)
├── types.ts              # All interfaces
├── config/
│   ├── loader.ts         # Find + load config file
│   ├── validator.ts      # Validate + apply defaults
│   └── resolver.ts       # Topological sort, cycle detection
├── process/
│   ├── manager.ts        # Orchestrate all processes by dependency tiers
│   ├── runner.ts         # Single process: spawn, PTY, readyPattern matching
│   └── ready.ts          # Readiness detection logic
├── ui/
│   ├── app.ts            # Top-level layout + event wiring
│   ├── tabs.ts           # TabSelectRenderable wrapper with status icons
│   ├── pane.ts           # ScrollBox + GhosttyTerminalRenderable per process
│   └── status-bar.ts     # Bottom bar: process states + keybinding hints
└── utils/
    ├── logger.ts         # File-based debug logger (console is captured by OpenTUI)
    └── shutdown.ts       # SIGINT/SIGTERM → graceful teardown
```

## Architecture

### Data Flow

```
Config file → [Loader] → [Validator] → [Resolver (topo sort)]
                                              ↓
                                        [ProcessManager]
                                         ↓           ↓
                              .startAll()          events (output, status)
                                  ↓                    ↓
                           [ProcessRunner]          [App (UI)]
                                ↓                      ↓
                          Bun.spawn PTY         OpenTUI renderer
                                ↓                      ↓
                          PTY data callback → GhosttyTerminal.feed()
```

### UI Layout

```
┌──────────────────────────────────────────┐
│ [● db] [● migrate] [● api] [● web]      │  ← TabSelect (h=3)
├──────────────────────────────────────────┤
│                                          │
│  (scrollable terminal output for the     │  ← ScrollBox + GhosttyTerminal
│   currently selected process)            │     (flexGrow: 1)
│                                          │
├──────────────────────────────────────────┤
│ db:ready | api:running   Ctrl+C: quit    │  ← StatusBar (h=1)
└──────────────────────────────────────────┘
```

### Key Types

```ts
interface NumuxProcessConfig {
  command: string
  cwd?: string
  env?: Record<string, string>
  dependsOn?: string[]
  readyPattern?: string
  persistent?: boolean          // default true, false = one-shot
  color?: string
}

interface NumuxConfig {
  processes: Record<string, NumuxProcessConfig>
}

type ProcessStatus =
  | 'pending' | 'starting' | 'ready'
  | 'running' | 'stopping' | 'stopped'
  | 'failed' | 'skipped'
```

### Dependency Resolution

Kahn's topological sort groups processes into tiers:
- Tier 0: processes with no deps → start concurrently
- Tier 1: processes whose deps are all in tier 0 → start after tier 0 is ready
- etc.

A process becomes "ready" when:
- **persistent + readyPattern**: pattern matches in stdout
- **persistent + no readyPattern**: immediately after spawn
- **non-persistent**: exits with code 0

If a process fails, all its dependents are marked `skipped`.

### Process Spawning

Commands run via `Bun.spawn(['sh', '-c', command], { terminal: { cols, rows, data } })`:
- `sh -c` handles pipes, `&&`, env vars in commands
- `terminal` option gives a real PTY (processes see a TTY, emit colors)
- `data` callback streams raw VT output → `GhosttyTerminalRenderable.feed()`
- `FORCE_COLOR=1` in env encourages color output

### Non-persistent Processes in UI

One-shot commands (like migrations) get a normal tab. Their output stays viewable after exit. Tab icon updates to show completion/failure status.

### Graceful Shutdown

Ctrl+C → stop processes in reverse dependency order (SIGTERM → 5s timeout → SIGKILL) → `renderer.destroy()` → exit.

## Implementation Steps

1. **Project setup**: Update `package.json` for Bun, create `tsconfig.json`, install deps (`@opentui/core`, `ghostty-opentui`, `bun-types`)
2. **Types**: `src/types.ts`
3. **Config layer**: `loader.ts`, `validator.ts`, `resolver.ts`
4. **Process layer**: `runner.ts` (PTY spawn + readiness), `manager.ts` (orchestration)
5. **UI layer**: `pane.ts` → `tabs.ts` → `status-bar.ts` → `app.ts`
6. **Entry point + shutdown**: `index.ts`, `shutdown.ts`, `logger.ts`

## Verification

1. Create a test `numux.config.ts` with 2-3 processes (e.g. `echo` commands with `sleep`)
2. Run `bun run src/index.ts` — should show tabbed UI with process output
3. Verify tab clicking/keyboard switching works
4. Verify dependency ordering (process B waits for A's readyPattern)
5. Verify Ctrl+C cleanly shuts down all processes and restores terminal
6. Verify a failed dependency cascades `skipped` status to dependents
