# Plan: Add example/ project for manual CLI testing

## Context
There's no easy way to manually test the numux CLI against realistic processes. The root `numux.config.ts` uses `echo + sleep` which works but isn't very representative. We want a committed `example/` directory that serves as both a developer testing ground and a usage example for users.

## Structure

```
example/
  package.json          # depends on numux via "file:.."
  numux.config.ts       # uses defineConfig() import from numux
  servers/
    api.ts              # fake HTTP-style server with periodic request logs
    worker.ts           # fake background job processor
    db.ts               # fake database startup (non-persistent migration script)
```

## Files

### `example/package.json`
- `"numux": "file:.."` dependency to link the parent package
- Script: `"dev": "numux"` so `bun run dev` launches numux

### `example/numux.config.ts`
- Uses `import { defineConfig } from 'numux'` to test the public API
- 3-4 processes demonstrating features:
  - **db**: persistent, prints startup logs then "ready to accept connections" (`readyPattern`), periodic health check logs
  - **migrate**: non-persistent, depends on `db`, runs and exits
  - **api**: persistent, depends on `migrate`, `readyPattern`, periodic "handled GET /users" style logs, colored
  - **worker**: persistent, depends on `db`, periodic "processed job #N" logs, colored

### `example/servers/api.ts`
Simple Bun script that:
- Prints startup banner
- After ~500ms prints "listening on http://localhost:3000"
- Every 1-3s prints a random fake HTTP request log (method, path, status, duration)
- Handles SIGTERM/SIGINT for clean shutdown

### `example/servers/worker.ts`
Simple Bun script that:
- Prints "worker starting..."
- Every 2-4s prints "processed job #N" with incrementing counter
- Occasionally prints a warning or slow job message
- Handles SIGTERM/SIGINT

### `example/servers/db.ts`
Simple Bun script that:
- Prints database startup sequence over ~1s
- Prints "ready to accept connections"
- Every 5s prints a quiet health check log
- Handles SIGTERM/SIGINT

## Changes to existing files
- **Root `numux.config.ts`**: Leave as-is (it's the simplest possible demo)

## Verification
1. `cd example && bun install` — should link numux from parent
2. `bunx numux` or `bun run dev` — should launch the TUI with all 4 processes
3. `bunx numux --prefix` — should show prefixed interleaved output
4. Verify dependency ordering: db → migrate → api/worker
5. Verify `defineConfig` import works (proves the public API export)
