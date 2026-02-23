#!/usr/bin/env bun
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

function parseArgs(argv: string[]): {
	help: boolean
	version: boolean
	debug: boolean
	configPath?: string
	commands: string[]
	named: Array<{ name: string; command: string }>
} {
	const result = {
		help: false,
		version: false,
		debug: false,
		configPath: undefined as string | undefined,
		commands: [] as string[],
		named: [] as Array<{ name: string; command: string }>
	}

	const args = argv.slice(2) // skip bun + script
	let i = 0

	while (i < args.length) {
		const arg = args[i]

		if (arg === '-h' || arg === '--help') {
			result.help = true
		} else if (arg === '-v' || arg === '--version') {
			result.version = true
		} else if (arg === '--debug') {
			result.debug = true
		} else if (arg === '-c' || arg === '--config') {
			result.configPath = args[++i]
		} else if (arg === '-n' || arg === '--name') {
			const value = args[++i]
			const eq = value?.indexOf('=')
			if (!value || eq === undefined || eq < 1) {
				console.error(`Invalid --name value: expected "name=command", got "${value}"`)
				process.exit(1)
			}
			result.named.push({
				name: value.slice(0, eq),
				command: value.slice(eq + 1)
			})
		} else if (!arg.startsWith('-')) {
			result.commands.push(arg)
		} else {
			console.error(`Unknown option: ${arg}`)
			process.exit(1)
		}

		i++
	}

	return result
}

function buildConfigFromArgs(commands: string[], named: Array<{ name: string; command: string }>): NumuxConfig {
	const processes: NumuxConfig['processes'] = {}

	for (const { name, command } of named) {
		processes[name] = { command, persistent: true }
	}

	for (let i = 0; i < commands.length; i++) {
		const cmd = commands[i]
		// Derive name from command: first word, deduplicated
		let name = cmd.split(/\s+/)[0].split('/').pop()!
		if (processes[name]) {
			name = `${name}-${i}`
		}
		processes[name] = { command: cmd, persistent: true }
	}

	return { processes }
}

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
		// CLI mode: build config from arguments
		config = buildConfigFromArgs(parsed.commands, parsed.named)
	} else {
		// Config file mode
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
