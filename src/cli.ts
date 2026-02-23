import type { NumuxConfig } from './types'

export interface ParsedArgs {
	help: boolean
	version: boolean
	debug: boolean
	configPath?: string
	only?: string[]
	exclude?: string[]
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
		} else if (arg === '--only') {
			result.only = args[++i]
				?.split(',')
				.map(s => s.trim())
				.filter(Boolean)
		} else if (arg === '--exclude') {
			result.exclude = args[++i]
				?.split(',')
				.map(s => s.trim())
				.filter(Boolean)
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

/** Filter a config to include/exclude specific processes. --only also pulls in transitive dependencies. */
export function filterConfig(config: NumuxConfig, only?: string[], exclude?: string[]): NumuxConfig {
	const allNames = Object.keys(config.processes)

	let selected: Set<string>

	if (only && only.length > 0) {
		// Validate names exist
		for (const name of only) {
			if (!allNames.includes(name)) {
				throw new Error(`--only: unknown process "${name}"`)
			}
		}
		// Collect transitive dependencies
		selected = new Set<string>()
		const queue = [...only]
		while (queue.length > 0) {
			const name = queue.pop()!
			if (selected.has(name)) continue
			selected.add(name)
			const deps = config.processes[name].dependsOn ?? []
			for (const dep of deps) {
				if (!selected.has(dep)) queue.push(dep)
			}
		}
	} else {
		selected = new Set(allNames)
	}

	if (exclude && exclude.length > 0) {
		for (const name of exclude) {
			if (!allNames.includes(name)) {
				throw new Error(`--exclude: unknown process "${name}"`)
			}
			selected.delete(name)
		}
	}

	if (selected.size === 0) {
		throw new Error('No processes left after filtering')
	}

	const processes: NumuxConfig['processes'] = {}
	for (const name of selected) {
		const proc = { ...config.processes[name] }
		// Remove deps that were filtered out
		if (proc.dependsOn) {
			proc.dependsOn = proc.dependsOn.filter(d => selected.has(d))
			if (proc.dependsOn.length === 0) proc.dependsOn = undefined
		}
		processes[name] = proc
	}

	return { processes }
}
