#!/usr/bin/env bun
import { buildConfigFromArgs, parseArgs } from './cli'
import { loadConfig } from './config/loader'
import { validateConfig } from './config/validator'
import { ProcessManager } from './process/manager'
import type { NumuxConfig } from './types'
import { App } from './ui/app'
import { enableDebugLog } from './utils/logger'
import { setupShutdownHandlers } from './utils/shutdown'

const HELP = `numux — terminal multiplexer with dependency orchestration

Usage:
  numux                          Run processes from config file
  numux <cmd1> <cmd2> ...        Run ad-hoc commands in parallel
  numux -n name1=cmd1 -n name2=cmd2  Named ad-hoc commands

Options:
  -n, --name <name=command>  Add a named process
  -c, --config <path>        Config file path (default: auto-detect)
  --debug                    Enable debug logging to .numux/debug.log
  -h, --help                 Show this help
  -v, --version              Show version

Config files (auto-detected):
  numux.config.ts, numux.config.js, numux.config.json,
  or "numux" key in package.json`

async function main() {
	const parsed = parseArgs(process.argv)

	if (parsed.help) {
		console.info(HELP)
		process.exit(0)
	}

	if (parsed.version) {
		const pkg = await import('../package.json')
		console.info(`numux v${(pkg.default ?? pkg).version}`)
		process.exit(0)
	}

	if (parsed.debug) {
		enableDebugLog()
	}

	let config: NumuxConfig

	if (parsed.commands.length > 0 || parsed.named.length > 0) {
		config = buildConfigFromArgs(parsed.commands, parsed.named)
	} else {
		const raw = await loadConfig(parsed.configPath)
		config = validateConfig(raw)
	}

	const manager = new ProcessManager(config)
	const app = new App(manager, config)

	setupShutdownHandlers(app)
	await app.start()
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
