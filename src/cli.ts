import type { ResolvedNumuxConfig } from './types'

export interface ParsedArgs {
	help: boolean
	version: boolean
	debug: boolean
	init: boolean
	validate: boolean
	exec: boolean
	execName?: string
	execCommand?: string
	completions?: string
	prefix: boolean
	killOthers: boolean
	timestamps: boolean
	noRestart: boolean
	noWatch: boolean
	autoColors: boolean
	configPath?: string
	logDir?: string
	only?: string[]
	exclude?: string[]
	colors?: string[]
	workspace?: string
	commands: string[]
	named: Array<{ name: string; command: string }>
}

export function parseArgs(argv: string[]): ParsedArgs {
	const result: ParsedArgs = {
		help: false,
		version: false,
		debug: false,
		init: false,
		validate: false,
		exec: false,
		prefix: false,
		killOthers: false,
		timestamps: false,
		noRestart: false,
		noWatch: false,
		autoColors: false,
		configPath: undefined,
		commands: [],
		named: []
	}

	const args = argv.slice(2) // skip bun + script
	let i = 0

	/** Consume the next argument as a value for the given flag, erroring if missing */
	const consumeValue = (flag: string): string => {
		const next = args[++i]
		if (next === undefined) {
			throw new Error(`Missing value for ${flag}`)
		}
		return next
	}

	while (i < args.length) {
		const arg = args[i]

		if (arg === '-h' || arg === '--help') {
			result.help = true
		} else if (arg === '-v' || arg === '--version') {
			result.version = true
		} else if (arg === '--debug') {
			result.debug = true
		} else if (arg === '-p' || arg === '--prefix') {
			result.prefix = true
		} else if (arg === '--kill-others') {
			result.killOthers = true
		} else if (arg === '-t' || arg === '--timestamps') {
			result.timestamps = true
		} else if (arg === '--no-restart') {
			result.noRestart = true
		} else if (arg === '-w' || arg === '--workspace') {
			result.workspace = consumeValue(arg)
		} else if (arg === '--no-watch') {
			result.noWatch = true
		} else if (arg === '--colors') {
			result.autoColors = true
		} else if (arg === '--config') {
			result.configPath = consumeValue(arg)
		} else if (arg === '-c' || arg === '--color') {
			result.colors = consumeValue(arg)
				.split(',')
				.map(s => s.trim())
				.filter(Boolean)
		} else if (arg === '--log-dir') {
			result.logDir = consumeValue(arg)
		} else if (arg === '--only') {
			result.only = consumeValue(arg)
				.split(',')
				.map(s => s.trim())
				.filter(Boolean)
		} else if (arg === '--exclude') {
			result.exclude = consumeValue(arg)
				.split(',')
				.map(s => s.trim())
				.filter(Boolean)
		} else if (arg === '-n' || arg === '--name') {
			const value = consumeValue(arg)
			const eq = value.indexOf('=')
			if (eq < 1) {
				throw new Error(`Invalid --name value: expected "name=command", got "${value}"`)
			}
			result.named.push({
				name: value.slice(0, eq),
				command: value.slice(eq + 1)
			})
		} else if (arg === 'init' && result.commands.length === 0) {
			result.init = true
		} else if (arg === 'validate' && result.commands.length === 0) {
			result.validate = true
		} else if (arg === 'exec' && result.commands.length === 0) {
			result.exec = true
			const name = args[++i]
			if (!name) throw new Error('exec requires a process name')
			result.execName = name
			// Skip optional --
			if (args[i + 1] === '--') i++
			const rest = args.slice(i + 1)
			if (rest.length === 0) throw new Error('exec requires a command to run')
			result.execCommand = rest.join(' ')
			break
		} else if (arg === 'completions' && result.commands.length === 0) {
			result.completions = consumeValue(arg)
		} else if (!arg.startsWith('-')) {
			result.commands.push(arg)
		} else {
			throw new Error(`Unknown option: ${arg}`)
		}

		i++
	}

	return result
}

export function buildConfigFromArgs(
	commands: string[],
	named: Array<{ name: string; command: string }>,
	options?: { noRestart?: boolean; colors?: string[] }
): ResolvedNumuxConfig {
	const processes: ResolvedNumuxConfig['processes'] = {}
	const maxRestarts = options?.noRestart ? 0 : undefined
	const colors = options?.colors
	let colorIndex = 0

	for (const { name, command } of named) {
		const color = colors?.[colorIndex++ % colors.length]
		processes[name] = { command, persistent: true, maxRestarts, ...(color ? { color } : {}) }
	}

	for (let i = 0; i < commands.length; i++) {
		const cmd = commands[i]
		// Derive name from command: first word, deduplicated
		let name = cmd.split(/\s+/)[0].split('/').pop()!
		if (processes[name]) {
			name = `${name}-${i}`
		}
		const color = colors?.[colorIndex++ % colors.length]
		processes[name] = { command: cmd, persistent: true, maxRestarts, ...(color ? { color } : {}) }
	}

	return { processes }
}

/** Filter a config to include/exclude specific processes. --only also pulls in transitive dependencies. */
export function filterConfig(config: ResolvedNumuxConfig, only?: string[], exclude?: string[]): ResolvedNumuxConfig {
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

	const processes: ResolvedNumuxConfig['processes'] = {}
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
