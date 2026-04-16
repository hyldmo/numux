# CLAUDE.md

Terminal multiplexer with dependency orchestration. Written in TypeScript, runs on Bun.

## Commands

```sh
bun test            # Run tests
bun run dev         # Run in dev mode
bun run typecheck   # TypeScript check (bunx tsc --noEmit)
bun run lint        # Lint with Biome
bun run fix         # Auto-fix lint/format issues
```

## Code style

- Formatter: Biome (tabs, single quotes, no semicolons, no trailing commas)
- Tests: `*.test.ts` files next to source, using Bun's built-in test runner
- Package manager: Bun (not npm/npx/yarn)

## Project structure

```
src/
├── index.ts              # CLI entry point
├── cli.ts                # CLI parser
├── config.ts             # Config export
├── types.ts              # Core types
├── config/               # Config loading, validation, dependency resolution
├── process/              # Process spawning, lifecycle, readiness detection
├── ui/                   # TUI layer (OpenTUI) - tabs, panes, status bar
└── utils/                # Logger, file watcher, color, env-file, shutdown
```

## Key behavior

- Panes are **readonly by default** — keyboard input is not forwarded to processes. Press `Enter` to enter **input mode** (forwards keystrokes to the process for y/n prompts etc.), `Escape` to exit
- Left/Right arrows cycle tabs, Up/Down arrows scroll by line, Shift+Up/Down scroll to top/bottom, PageUp/PageDown scroll by page, Home/End to top/bottom
- Mouse drag selects text and auto-copies to clipboard (OSC 52); `Y` key also copies selection
- `T` toggles an `HH:MM:SS` timestamp gutter in TUI mode; also enabled via `timestamps: true` config or `--timestamps` flag. Accepts a format string (e.g. `timestamps: "HH:mm:ss.SSS"`) with tokens: `YYYY`, `MM`, `DD`, `HH`, `hh`, `mm`, `ss`, `SSS`, `A`
- Compact keybinding hints in the status bar; `H` or `?` opens a full help overlay. Config lives in `src/ui/keybindings.ts`
- Set `interactive: true` on processes that need stdin (REPLs, shells)
- Non-interactive panes hide the terminal cursor (shown during input mode)
- Set `errorMatcher: true` to detect ANSI red output, or a regex string to match custom patterns — shows a red indicator on the tab while the process keeps running
- `readyPattern` accepts `string` (simple match) or `RegExp` (match + capture groups). RegExp captures are expanded into dependent `command` and `env` values via `$dep.group` syntax (e.g. `$odoo.url`)
- `optional: true` makes a process visible as a tab but not auto-started (starts in `stopped` state). Alt+S starts it manually. Unlike `condition`, optional does not cascade to dependents
- `platform` restricts a process to specific OS(es) (e.g. `'darwin'`, `'linux'`). Non-matching processes are removed; their dependents still start with the dependency stripped (unlike `condition` which cascades)

## Commits

Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/) format: `type(scope): subject`. Enforced by commitlint via a git hook (`.githooks/commit-msg`) and in CI.

## CI

Runs on PRs: commitlint, typecheck, lint, test.

## Hooks

### PreToolUse hooks (.claude/settings.json)

- **Bash matcher**: Runs `save-learnings-reminder.sh` before any Bash tool call. On `git commit` commands, injects a reminder to save session learnings to memory files or CLAUDE.md.

### Stop hooks (.claude/settings.json)

- **Auto-fix**: Runs `bun run fix` when a Claude session ends, ensuring code is always formatted.

### Hookify rules (.claude/)

| Rule | Action | Pattern | Purpose |
|------|--------|---------|---------|
| `block-force-delete` | block | `rm\s+.*-[^\s]*f` | Prevents `rm -f`; use `rm` without force flag |
| `block-npx` | block | `\bnpx\s+` | Prevents npx; use `bun`/`bunx` instead |
| `no-git-c-flag` | block | `git\s+-C\s+` | Prevents `git -C`; already in correct directory |
| `save-learnings-on-commit` | warn | `git\s+commit` | Reminds to save learnings before committing |

### Headless runner (.claude/run.sh)

Infinite-loop script for unattended Claude sessions. Runs with restricted tool access and a default prompt to implement next steps from `.claude/plans/`.
