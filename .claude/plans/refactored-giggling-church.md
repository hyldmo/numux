# Save logs to files & use grep for search

## Context

The TUI search currently calls `getText()` — an expensive FFI call into Ghostty's terminal buffer — then does a JavaScript `indexOf` loop over every line. This is slow on large output and requires maintaining in-memory text caches that get invalidated on every feed/resize/clear.

Instead: always write process output to log files and use `grep` to search them. Less custom code, better performance — grep is highly optimized for this exact job.

## Plan

### 1. Always create LogWriter (`src/index.ts`)

- When `--log-dir` is set: use that directory (existing behavior)
- When not set: create a temp directory via `mkdtempSync(join(tmpdir(), 'numux-'))`
- Pass `logWriter` to `App` constructor (currently only passed in prefix mode)
- On shutdown: call `logWriter.close()`, then `rmSync` the temp dir if we created it

### 2. Add `search()` and `getLogPath()` to LogWriter (`src/utils/log-writer.ts`)

- `getLogPath(name: string): string | undefined` — returns the path for a process's log file (if it exists)
- `async search(name: string, query: string): Promise<SearchMatch[]>` — spawns `grep -inb` on the log file, parses results into `SearchMatch[]`
  - Use `Bun.spawn(['grep', '-in', query, path])`
  - Parse `grep -in` output: `lineNumber:matchingLine` format
  - Find match positions within each line (case-insensitive indexOf, same as current)
  - Return empty array if process has no log file yet or grep finds nothing

### 3. Make search async in App (`src/ui/app.ts`)

- Accept `logWriter` in constructor, store as field
- Change `runSearch()` to `async runSearch()`
  - Call `logWriter.search(activePane, query)` instead of `pane.search(query)`
  - Guard against stale results (if query changed during async search, discard)
- `scheduleSearch` debounce already exists (100ms) — works well with async

### 4. Remove search from Pane (`src/ui/pane.ts`)

- Remove `search()` method
- Remove `_textLines` and `_textLinesLower` caches (lines 20-22)
- Remove cache invalidation from `feed()`, `resize()`, `clear()`
- Keep `getText()` — still needed by `getLinkAtMouse()` and `copyAllText()`
- For `getLinkAtMouse()`: call `getText()` inline and split (it's only called on Ctrl+click, not hot path)

### 5. Handle pane clear (`src/ui/app.ts` + `src/utils/log-writer.ts`)

- Add `truncate(name: string)` to LogWriter — closes and reopens the file to clear it
- Call `logWriter.truncate(name)` when the user presses `L` to clear a pane

## Files to modify

| File | Change |
|------|--------|
| `src/utils/log-writer.ts` | Add `getLogPath()`, `search()`, `truncate()` methods |
| `src/ui/pane.ts` | Remove `search()`, remove `_textLines`/`_textLinesLower` caches |
| `src/ui/app.ts` | Accept LogWriter, async search via grep, call truncate on clear |
| `src/index.ts` | Always create LogWriter, pass to App, clean up temp dir |
| `src/utils/log-writer.test.ts` | Add tests for `search()`, `getLogPath()`, `truncate()` |

## Verification

1. `bun run typecheck` — no type errors
2. `bun run lint` — passes
3. `bun test` — all existing + new tests pass
4. Manual: `bun run dev` with a config, press `F` to search, verify matches highlight and navigate correctly
