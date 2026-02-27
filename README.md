# numux

Terminal multiplexer with dependency orchestration. Run multiple processes in a tabbed TUI with a dependency graph controlling startup order.

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
      persistent: false,
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
      persistent: false,
    },
  },
})
```

The `defineConfig()` helper is optional — it provides type checking for your config.

Processes can be a string (shorthand for `{ command: "..." }`) or a full config object.

Then run:

```sh
numux
```

### Subcommands

```sh
numux init                         # Create a starter numux.config.ts
numux validate                     # Validate config and show process dependency graph
numux exec <name> [--] <command>   # Run a command in a process's environment
numux completions <shell>          # Generate shell completions (bash, zsh, fish)
```

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

# Named
numux -n api="bun dev:api" -n web="bun dev:web"
```

### Script patterns

Run multiple package.json scripts matching a glob pattern:

```sh
numux 'dev:*'             # all scripts matching dev:*
numux 'npm:*:dev'         # explicit npm: prefix (same behavior)
```

Extra arguments after the pattern are forwarded to each matched command:

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

Template properties (color, env, dependsOn, etc.) are inherited by all matched processes. Colors given as an array are distributed round-robin.

### Options

| Flag | Description |
|------|-------------|
| `-w, --workspace <script>` | Run a script across all workspaces |
| `-c, --config <path>` | Explicit config file path |
| `-n, --name <name=cmd>` | Add a named process (repeatable) |
| `-p, --prefix` | Prefixed output mode (no TUI, for CI/scripts) |
| `--only <a,b,...>` | Only run these processes (+ their dependencies) |
| `--exclude <a,b,...>` | Exclude these processes |
| `--kill-others` | Kill all processes when any exits |
| `--no-restart` | Disable auto-restart for crashed processes |
| `-s, --sort <mode>` | Tab display order: `config` (default), `alphabetical`, `topological` |
| `--no-watch` | Disable file watching even if config has `watch` patterns |
| `-t, --timestamps` | Add `[HH:MM:SS]` timestamps to prefixed output |
| `--log-dir <path>` | Write per-process output to `<path>/<name>.log` |
| `--debug` | Log to `.numux/debug.log` |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

### Prefix mode

Use `--prefix` (`-p`) for CI or headless environments. Output is printed with colored `[name]` prefixes instead of the TUI:

```sh
numux --prefix
```

Auto-exits when all processes finish. Exit code 1 if any process failed.

## Config reference

### Global options

Top-level options apply to all processes (process-level settings override):

| Field | Type | Description |
|-------|------|-------------|
| `cwd` | `string` | Working directory for all processes (process `cwd` overrides) |
| `env` | `Record<string, string>` | Environment variables merged into all processes (process `env` overrides per key) |
| `envFile` | `string \| string[] \| false` | `.env` file(s) for all processes (process `envFile` replaces if set; `false` disables) |
| `showCommand` | `boolean` | Print the command being run as the first line of output (default: `true`) |
| `sort` | `'config' \| 'alphabetical' \| 'topological'` | Tab display order (default: `'config'` — definition order) |

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

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `command` | `string` | *required* | Shell command to run. Supports `$dep.group` references from dependency capture groups |
| `cwd` | `string` | `process.cwd()` | Working directory |
| `env` | `Record<string, string>` | — | Extra environment variables. Values support `$dep.group` references from dependency capture groups |
| `envFile` | `string \| string[] \| false` | — | `.env` file path(s) to load (relative to `cwd`); `false` disables inherited envFile |
| `dependsOn` | `string[]` | — | Processes that must be ready first |
| `readyPattern` | `string \| RegExp` | — | Regex matched against stdout to signal readiness. Use `RegExp` to capture groups (see below) |
| `readyTimeout` | `number` | — | Milliseconds to wait for `readyPattern` before failing |
| `persistent` | `boolean` | `true` | `false` for one-shot commands (exit 0 = ready) |
| `maxRestarts` | `number` | `Infinity` | Max auto-restart attempts before giving up |
| `delay` | `number` | — | Milliseconds to wait before starting the process |
| `condition` | `string` | — | Env var name; process skipped if falsy. Prefix with `!` to negate |
| `platform` | `string \| string[]` | — | OS(es) this process runs on (e.g. `'darwin'`, `'linux'`). Non-matching processes are removed; dependents still start |
| `stopSignal` | `string` | `SIGTERM` | Signal for graceful stop (`SIGTERM`, `SIGINT`, or `SIGHUP`) |
| `color` | `string \| string[]` | auto | Hex (e.g. `"#ff6600"`) or basic name: black, red, green, yellow, blue, magenta, cyan, white, gray, orange, purple |
| `watch` | `string \| string[]` | — | Glob patterns — restart process when matching files change |
| `interactive` | `boolean` | `false` | When `true`, keyboard input is forwarded to the process |
| `errorMatcher` | `boolean \| string` | — | `true` detects ANSI red output, string = regex pattern — shows error indicator on tab |
| `showCommand` | `boolean` | `true` | Print the command being run as the first line of output |

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
      persistent: false,
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

### Dependency orchestration

Each process starts as soon as its declared `dependsOn` dependencies are ready — it does not wait for unrelated processes. If a process fails, its dependents are skipped.

A process becomes **ready** when:
- **persistent + readyPattern** — the pattern matches in stdout
- **persistent + no readyPattern** — immediately after spawn
- **non-persistent** — exits with code 0

Persistent processes that crash are auto-restarted with exponential backoff (1s–30s). Backoff resets after 10s of uptime.

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

## Tab icons

| Icon | Status |
|------|--------|
| ○ | Pending |
| ◐ | Starting |
| ◉ | Running |
| ● | Ready |
| ◑ | Stopping |
| ■ | Stopped |
| ✖ | Failed |
| ⊘ | Skipped |

## Dependencies

### ghostty-opentui

Despite the name, [`ghostty-opentui`](https://github.com/remorses/ghostty-opentui) is **not** a compatibility layer for the [Ghostty](https://ghostty.org) terminal. It uses Ghostty's Zig-based VT parser as the ANSI terminal emulation engine for OpenTUI's terminal renderable. It works in any terminal emulator (iTerm, Kitty, Alacritty, WezTerm, etc.) and adds ~8MB to install size due to native binaries.

## License

MIT
