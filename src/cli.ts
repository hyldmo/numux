import type { NumuxConfig } from './types'

export interface ParsedArgs {
	help: boolean
	version: boolean
	debug: boolean
	configPath?: string
	commands: string[]
	named: Array<{ name: string; command: string }>
}

export function parseArgs(argv: string[]): ParsedArgs {
	const result: ParsedArgs = {
		help: false,
		version: false,
		debug: false,
		configPath: undefined,
		commands: [],
		named: []
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

export function buildConfigFromArgs(commands: string[], named: Array<{ name: string; command: string }>): NumuxConfig {
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
