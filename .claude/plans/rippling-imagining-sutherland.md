# numux — Project Init Plan

## Context
Initialize `numux`, a Node.js + TypeScript CLI tool that's an alternative to tmux + concurrently. Config-file based AND CLI-firstt. Lives at `/Users/hyldmo/dev/hyldmo/numux/`.

## Design Decisions

- **CLI framework:** `citty` (unjs) — tiny, TypeScript-first, ESM-native, supports subcommands
- **Terminal output (v0.1):** Prefixed output like concurrently — no TUI yet, just colored `[name]` prefixes
- **Process management:** `node:child_process` spawn — no external library needed
- **Coloring:** `chalk` v5 (ESM-only, perfect fit)
- **Build:** `tsc` — simple, direct, no bundler needed for a CLI tool
- **Config format (v0.1):** JSON only, YAML/TOML later

## File Structure

```
numux/
├── .github/workflows/ci.yml
├── .husky/commit-msg, pre-commit
├── src/
│   ├── index.ts      # CLI entry (bin)
│   ├── types.ts       # Core types
│   ├── runner.ts      # Process spawning (stub)
│   ├── output.ts      # Prefixed output formatting
│   └── config.ts      # Config file loading (stub)
├── package.json
├── tsconfig.json
├── biome.json         # User's provided config
├── .gitignore
├── .yarnrc.yml
├── release.config.js
└── README.md
```

## Key Details

- **package.json:** Yarn 4.x, `type: module`, `bin: ./dist/index.js`, includes `fix` script (needed by Claude Code hook)
- **tsconfig.json:** ES2024 target, NodeNext module, strict mode with all strict flags from repo convention
- **biome.json:** The config you provided, with `noConsole: off` since this is a CLI tool
- **src/index.ts:** Parses CLI args via citty, shows help, stubs out process running

## Execution Steps

1. Create all config files (`.gitignore`, `.yarnrc.yml`, `package.json`, `tsconfig.json`, `biome.json`, `release.config.js`)
2. Set up Yarn 4 (`yarn set version 4.12.0`) and install dependencies
3. Create source files in `src/`
4. Set up husky hooks and CI workflow
5. Build and verify (`yarn build && node dist/index.js --help`)

## Verification
- `yarn build` compiles without errors
- `yarn lint` passes
- `node dist/index.js --help` shows usage info
- `node dist/index.js "echo hello" "echo world"` shows parsed commands
