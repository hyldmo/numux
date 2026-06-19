# numux

Terminal multiplexer with dependency orchestration. Run multiple processes in a tabbed TUI with a dependency graph controlling startup order, readiness detection, and output capture between processes.

Works with zero configuration — pass commands as arguments, run a script across monorepo workspaces with `-w`, or match multiple scripts with glob patterns like `'dev:*'`. For advanced setups, define a typed config with conditional processes, file watching with auto-restart, error detection, log persistence, and output capture — e.g. extract a port from one process's stdout and pass it to another process's command or env.

Inspired by `sst dev` and `concurrently`

## Install

Requires [Bun](https://bun.sh) >= 1.0.

```sh
bun install -g numux
```

## Usage

### Quick start

```sh
numux init
```

This creates a starter `numux.config.ts` with commented-out examples. Edit it, then run `numux`.

### Config file

Create `numux.config.ts` (or `.js`):

```ts
import { defineConfig } from 'numux'

export default defineConfig({
  processes: {
    db: {
      command: 'docker compose up postgres',
      readyPattern: 'ready to accept connections',
    },
    migrate: {
      command: 'bun run migrate',
      dependsOn: ['db'],
    },
    api: {
      command: 'bun run dev:api',
      dependsOn: ['migrate'],
      readyPattern: 'listening on port 3000',
    },
    // String shorthand for simple processes
    web: 'bun run dev:web',
    // Interactive process — keyboard input is forwarded
    confirm: {
      command: 'sh -c "printf \'Deploy to staging? [y/n] \' && read answer && echo $answer"',
      interactive: true,
    },
  },
})
```

The `defineConfig()` helper is optional — it provides type checking for your config.

Processes can be a string (shorthand for `{ command: "..." }`), `true` or `{}` (auto-resolves to a matching `package.json` script), or a full config object.

Then run:

```sh
numux
```

### Subcommands

<!-- generated:subcommands -->
```sh
numux init                         # Create a starter config file
numux validate                     # Validate config and show process graph
numux exec <name> [--] <cmd>       # Run a command in a process's environment
numux logs [name]                  # Open the log directory or a specific process log
numux completions <shell>          # Generate shell completions (bash, zsh, fish)
numux help [topic]                 # Show help for a topic
```
<!-- /generated:subcommands -->

`validate` respects `--only`/`--exclude` filters and shows processes grouped by dependency tiers.

`exec` runs a one-off command using a process's configured `cwd`, `env`, and `envFile` — useful for migrations, scripts, or any command that needs the same environment:

```sh
numux exec api -- npx prisma migrate
numux exec web npm run build
```

Set up completions for your shell:

```sh
# Bash (add to ~/.bashrc)
eval "$(numux completions bash)"

# Zsh (add to ~/.zshrc)
eval "$(numux completions zsh)"

# Fish
numux completions fish | source
# Or save permanently:
numux completions fish > ~/.config/fish/completions/numux.fish
```

### Workspaces

Run a `package.json` script across all workspaces in a monorepo:

```sh
numux -w dev
```

Reads the `workspaces` field from your root `package.json`, finds which workspaces have the given script, and spawns `<pm> run <script>` in each. The package manager is auto-detected from `packageManager` field or lockfiles.

Composes with other flags:

```sh
numux -w dev -n redis="redis-server" --colors
```

### Ad-hoc commands

```sh
# Unnamed (name derived from command)
numux "bun dev:api" "bun dev:web"

# Named process
numux -n api="bun dev:api" -n web="bun dev:web"
```

### Script patterns

Run package.json scripts by name — any colon-containing name is automatically recognized as a script reference:

```sh
numux 'lint:eslint --fix'  # runs: yarn run lint:eslint --fix
numux 'dev:*'              # all scripts matching dev:*
numux 'npm:*:dev'          # explicit npm: prefix (same behavior)
```

<!-- generated:script-pattern-rules -->
## Script pattern rules

**Recognition:** A process name is treated as a script reference when it:
- starts with `npm:` (e.g. `npm:dev:*`)
- contains glob metacharacters (`*`, `?`, `[`)
- contains a colon AND has no explicit `command` (e.g. `lint:eslint: {}`)

**Glob matching:** Patterns are matched against `package.json` scripts using
`Bun.Glob`. The `*` wildcard does NOT match across `:` separators — `dev:*`
matches `dev:web` but not `dev:web:hmr`. Use `dev:*:*` for two levels deep.

**Leaf-only (`^`):** Append `^` to skip scripts that are group runners —
scripts that have sub-scripts beneath them. E.g. if `format:check` has
`format:check:store` and `format:check:odoo` below it, `format:*^` excludes
`format:check` but keeps the leaf scripts.

**Extra args:** Anything after the first space in the pattern is forwarded
as extra arguments to each matched command: `lint:* --fix` → `bun run lint:js -- --fix`.

**Template inheritance:** Config properties on a pattern entry (color, env,
dependsOn, etc.) are inherited by all expanded processes. Color arrays are
distributed round-robin across matches.

**Display names:** The glob's literal prefix and suffix are stripped from
matched script names: `dev:*` + `dev:web` → display name `web`.

## Auto-resolution

When a process has no `command` and its name matches a `package.json` script,
the command is auto-resolved to `<pm> run <name>`. This works for:
- `true` or `{}` shorthand: `lint: true` → `bun run lint`
- Objects without `command`: `typecheck: { dependsOn: ['db'] }` → `bun run typecheck`

## npm: prefix

Commands starting with `npm:` are rewritten to use the detected package
manager: `npm:dev` → `bun run dev` (if bun is detected).
<!-- /generated:script-pattern-rules -->

```sh
numux 'lint:* --fix'      # → bun run lint:js --fix, bun run lint:ts --fix
```

In a config file, use the pattern as the process name:

```ts
export default defineConfig({
  processes: {
    'dev:*': { color: ['green', 'cyan'] },
    'lint:* --fix': {},
  },
})
```

Auto-resolution example:

```ts
export default defineConfig({
  processes: {
    lint: true,                       // → bun run lint
    typecheck: { dependsOn: ['db'] }, // → bun run typecheck (with dependency)
    db: 'docker compose up postgres', // explicit command, not resolved
  },
})
```

### Options

<!-- generated:options -->
| Flag | Description |
|------|-------------|
| `-s,` `--sort` `<config|alphabetical|topological|status>` | Tab display order |
| `-w,` `--workspace` `<script>` | Run a package.json script across all workspaces |
| `-n,` `--name` `<name=command>` | Add a named process |
| `-c,` `--color` `<colors>` | Comma-separated colors (hex or names: black, red, green, yellow, blue, magenta, cyan, white, gray, orange, purple) |
| `--colors` | Auto-assign colors to processes based on their name |
| `-e,` `--env-file` `<path|false>` | Env file path, or "false" to disable env file loading |
| `--config` `<path>` | Config file path (default: auto-detect) |
| `-p,` `--prefix` | Prefixed output mode (no TUI, for CI/scripts) |
| `-o,` `--only` `<a,b,...>` | Only run these processes (+ their dependencies) |
| `-x,` `--exclude` `<a,b,...>` | Exclude these processes |
| `--kill-others` | Kill all processes when any exits (regardless of exit code) |
| `--kill-others-on-fail` | Kill all processes when any exits with non-zero code |
| `--max-restarts` `<n>` | Max auto-restarts for crashed processes |
| `--no-watch` | Disable file watching even if config has watch patterns |
| `-t,` `--timestamps` `[<format>]` | Add timestamps to output (default HH:mm:ss.SSS, or pass a format string) |
| `--log-dir` `<path>` | Write per-process logs to directory |
| `--theme` `<light|dark|auto>` | TUI theme (auto detects terminal background) |
| `--debug` | Enable debug logging to .numux/debug.log |
| `-h,` `--help` | Show this help |
| `-v,` `--version` | Show version |
<!-- /generated:options -->

### Prefix mode

Use `--prefix` (`-p`) for CI or headless environments. Output is printed with colored `[name]` prefixes instead of the TUI:

```sh
numux --prefix
```

Auto-exits when all processes finish. Exit code 1 if any process failed.

## Logging

numux writes per-process log files (ANSI-stripped) for every run. By default they go to `<tmpdir>/numux/<project-name>/`, or to `--log-dir` / the `logDir` config when set. Each session creates a timestamped subdirectory with a `latest` symlink pointing to the most recent run.

The TUI prints `Logs saved to: <session-dir>` on exit (Ctrl+C or signal). Multiple numux instances in the same project share the default base dir, so each session has its own timestamped folder but the `latest` symlink will point at whichever started most recently. If `numux logs` falls back to the default and a `latest` symlink is in use, it prints a warning. To avoid the collision, set `logDir` per config or pass `--log-dir`.

<!-- generated:logging-usage -->
```sh
numux logs                         # Print log directory path
numux logs api                     # Pipe the api process log to stdout
numux logs api | grep "ERROR"      # Search process logs
numux logs api | tail -f           # Follow process log output
```
<!-- /generated:logging-usage -->


## Config reference

### Global options

Top-level options apply to all processes (process-level settings override):

<!-- generated:config-global -->
| Field | Type | Description |
|-------|------|-------------|
| `cwd` | `string` | Global working directory, inherited by all processes |
| `env` | `Record<string, string>` | Global env vars, merged into each process (process-level overrides) |
| `envFile` | `string \| string[] \| false` | Global .env file(s), inherited by processes without their own envFile; `false` disables |
| `showCommand` | `boolean` | Global showCommand flag, inherited by all processes |
| `maxRestarts` | `number` | Global restart limit, inherited by all processes (only restarts on non-zero exit) |
| `readyTimeout` | `number` | Global ready timeout (ms), inherited by all processes |
| `stopSignal` | `'SIGTERM' \| 'SIGINT' \| 'SIGHUP'` | Global stop signal, inherited by all processes |
| `errorMatcher` | `boolean \| string` | Global error matcher, inherited by all processes. `true` = detect ANSI red output, string = regex |
| `watch` | `string \| string[]` | Global watch patterns, inherited by processes without their own watch |
| `sort` | `'config' \| 'alphabetical' \| 'topological' \| 'status'` | Tab display order. `'config'` preserves definition order (package.json script order for wildcards), `'alphabetical'` sorts by process name, `'topological'` sorts by dependency tiers, `'status'` uses config order but moves finished/stopped/failed/skipped tabs to the bottom. |
| `prefix` | `boolean` | Use prefixed output mode instead of TUI (for CI/scripts) |
| `timestamps` | `boolean \| string` | Add timestamps to output lines. `true` uses default `HH:mm:ss.SSS` format, or pass a format string (e.g. `"HH:mm:ss"`) |
| `killOthers` | `boolean` | Kill all processes when any one exits (regardless of exit code) |
| `killOthersOnFail` | `boolean` | Kill all processes when any one exits with a non-zero exit code |
| `noWatch` | `boolean` | Disable file watching even if processes have watch patterns |
| `logDir` | `string` | Directory to write per-process log files |
| `theme` | `ThemePref` | TUI color theme. `'auto'` detects the terminal background via OSC 11 (falling back to `COLORFGBG` then dark). `'light'`/`'dark'` skip detection. |
<!-- /generated:config-global -->

```ts
export default defineConfig({
  cwd: './packages/backend',
  env: { NODE_ENV: 'development' },
  envFile: '.env',
  processes: {
    api: { command: 'node server.js' },           // inherits cwd, env, envFile
    web: { command: 'vite', cwd: './packages/web' }, // overrides cwd
  },
})
```

### Process options

Each process accepts:

<!-- generated:config-process -->
| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` | `string` | *required* | Shell command to run. Supports `$dep.group` references from dependency capture groups |
| `cwd` | `string` | — | Working directory for the process |
| `env` | `Record<string, string>` | — | Extra environment variables. Values support `$dep.group` references from dependency capture groups. |
| `envFile` | `string \| string[] \| false` | — | .env file path(s) to load, or `false` to disable |
| `dependsOn` | `string \| string[]` | — | Processes that must be ready before this one starts |
| `readyPattern` | `string \| RegExp` | — | Regex matched against stdout to signal readiness. Use `RegExp` to capture groups for `$dep.group` expansion |
| `maxRestarts` | `number` | `0` | Limit auto-restart attempts (only restarts on non-zero exit) |
| `readyTimeout` | `number` | — | Milliseconds to wait for readyPattern before failing |
| `delay` | `number` | — | Milliseconds to wait before starting the process |
| `condition` | `string` | — | Env var name (prefix with `!` to negate); process skipped if condition is falsy |
| `platform` | `string \| string[]` | — | OS(es) this process runs on (e.g. `'darwin'`, `'linux'`). Non-matching processes are removed, their dependents still start |
| `stopSignal` | `'SIGTERM' \| 'SIGINT' \| 'SIGHUP'` | `'SIGTERM'` | Signal for graceful stop |
| `color` | `string \| string[]` | — | Hex color (e.g. `"#ff6600"`) or color name. Array for round-robin in script patterns |
| `watch` | `string \| string[]` | — | Glob patterns — restart process when matching files change |
| `interactive` | `boolean` | `false` | When true, keyboard input is forwarded to the process |
| `optional` | `boolean` | — | Process is visible but not started automatically. Use Alt+S to start manually |
| `errorMatcher` | `boolean \| string` | — | `true` = detect ANSI red output, string = regex pattern |
| `workspaces` | `boolean \| string \| string[]` | — | Run command in monorepo workspaces. `true` = all workspaces, string = specific workspace by name/path, string[] = multiple workspaces |
| `showCommand` | `boolean` | `true` | Print the command being run as the first line of output |
<!-- /generated:config-process -->

### Workspace expansion

Use `workspaces` on a process to expand it into per-workspace processes. Reads the `workspaces` field from your root `package.json`.

```ts
export default defineConfig({
  processes: {
    // All workspaces — filters by script availability for PM run commands
    lint: { command: 'npm run lint', workspaces: true },

    // Specific workspace by package name
    validate: { command: 'npm run validate', workspaces: '@repo/image-worker' },

    // Multiple specific workspaces
    dev: { command: 'npm run dev', workspaces: ['@repo/api', '@repo/web'] },
  },
})
```

Each entry expands into `{name}:{wsName}` processes (e.g. `lint:api`, `lint:web`) with `cwd` set to the workspace directory. All other config (env, dependsOn, color, etc.) is inherited from the template.

When `workspaces: true` is used with a PM run command (`npm run lint`), only workspaces that have the matching script are included. Raw commands (`eslint .`) run in all workspaces.

String values resolve by package name first (with or without scope), then fall back to relative path. Cannot be combined with `cwd`.

### File watching

Use `watch` to automatically restart a process when source files change:

```ts
export default defineConfig({
  processes: {
    api: {
      command: 'node server.js',
      watch: 'src/**/*.ts',
    },
    styles: {
      command: 'sass --watch src:dist',
      watch: ['src/**/*.scss', 'src/**/*.css'],
    },
  },
})
```

Patterns are matched relative to the process's `cwd` (or the project root). Changes in `node_modules` and `.git` are always ignored. Rapid file changes are debounced (300ms) to avoid restart storms.

A watched process is only restarted if it's currently running, ready, or failed — manually stopped processes are not affected.

### Environment variable interpolation

Config values support `${VAR}` syntax for environment variable substitution:

```ts
export default defineConfig({
  processes: {
    api: {
      command: 'node server.js --port ${PORT:-3000}',
      env: {
        DATABASE_URL: '${DATABASE_URL:?DATABASE_URL must be set}',
      },
    },
  },
})
```

| Syntax | Behavior |
|--------|----------|
| `${VAR}` | Value of `VAR`, or empty string if unset |
| `${VAR:-default}` | Value of `VAR`, or `default` if unset |
| `${VAR:?error}` | Value of `VAR`, or error with message if unset |

Interpolation applies to all string values in the config (command, cwd, env, envFile, readyPattern, etc.).

### Conditional processes

Use `condition` to run a process only when an environment variable is set:

```ts
export default defineConfig({
  processes: {
    seed: {
      command: 'bun run seed',
      condition: 'SEED_DB',    // only runs when SEED_DB is set and truthy
    },
    storybook: {
      command: 'bun run storybook',
      condition: '!CI',         // skipped in CI environments
    },
  },
})
```

Falsy values: unset, empty string, `"0"`, `"false"`, `"no"`, `"off"` (case-insensitive). If a conditional process is skipped, its dependents are also skipped.

### Optional processes

Use `optional` for tools you want visible in tabs but not auto-started (e.g. Prisma Studio, debug servers):

```ts
export default defineConfig({
  processes: {
    app: { command: 'bun run dev' },
    studio: {
      command: 'bunx prisma studio',
      optional: true,  // shows as stopped tab, start with Alt+S
    },
  },
})
```

Unlike `condition`, optional processes don't cascade — their dependents still start normally.

### Dependency orchestration

Each process starts as soon as its declared `dependsOn` dependencies are ready — it does not wait for unrelated processes. If a process fails, its dependents are skipped.

A process becomes **ready** when:
- **Has `readyPattern`** — the pattern matches in stdout (long-running server)
- **No `readyPattern`** — exits with code 0 (one-shot task)

Processes that crash (non-zero exit) can be auto-restarted by setting `maxRestarts` (default: `0`). Restarts use exponential backoff (1s–30s), which resets after 10s of uptime.

### Dependency output capture

When `readyPattern` is a `RegExp` (not a string), capture groups are extracted on match and expanded into dependent process `command` and `env` values using `$process.group` syntax:

```ts
export default defineConfig({
  processes: {
    db: {
      command: 'docker compose up postgres',
      readyPattern: /ready to accept connections on port (?<port>\d+)/,
    },
    api: {
      command: 'node server.js --db-port $db.port',
      dependsOn: ['db'],
      env: { DB_PORT: '$db.port' },
    },
  },
})
```

Both named (`$db.port`) and positional (`$db.1`) references work. Named groups also populate positional slots, so `$db.port` and `$db.1` both resolve to the same value above.

Unmatched references are left as-is (the shell will expand `$db` as empty + `.port` literal, making the issue visible). String `readyPattern` values work as before — readiness detection only, no capture extraction.

## Keybindings

Keybindings are shown in the status bar at the bottom of the app. Panes are readonly by default — keyboard input is not forwarded to processes. Set `interactive: true` on processes that need stdin (REPLs, shells, etc.).

<!-- generated:keybindings -->
| Key | Action |
|-----|--------|
| `←`/`→` or `1`-`9` | Switch tabs |
| `Enter` | Input mode |
| `F` | Search |
| `R` | Restart |
| `Shift+R` | Restart all |
| `S` | Stop/start |
| `Y` | Copy all |
| `L` | Clear |
| `T` | Timestamps |
| `↑↓` | Scroll line |
| `Shift+↑↓` | Top/bottom |
| `G/Shift+G` | Top/bottom |
| `PgUp/PgDn` | Scroll page |
| `O` | Open logs |
| `Ctrl+Click` | Open link |
| `Ctrl+C` | Quit |
<!-- /generated:keybindings -->

Search mode (after pressing `F`):

| Key | Action |
|-----|--------|
| `Tab` | Toggle between single-pane and all-process search |
| `Enter`/`Shift+Enter` | Next/previous match |
| `Esc` | Exit search |
| `PageUp`/`PageDown` | Scroll by page |

## Tab icons

<!-- generated:tab-icons -->
| Icon | Status |
|------|--------|
| ○ | Pending |
| ◐ | Starting |
| ◉ | Running |
| ● | Ready |
| ◑ | Stopping |
| ■ | Stopped |
| ✓ | Finished |
| ✖ | Failed |
| ⊘ | Skipped |
<!-- /generated:tab-icons -->

## Dependencies

### ghostty-opentui

Despite the name, [`ghostty-opentui`](https://github.com/remorses/ghostty-opentui) is **not** a compatibility layer for the [Ghostty](https://ghostty.org) terminal. It uses Ghostty's Zig-based VT parser as the ANSI terminal emulation engine for OpenTUI's terminal renderable. It works in any terminal emulator (iTerm, Kitty, Alacritty, WezTerm, etc.) and adds ~8MB to install size due to native binaries.

## License

MIT
