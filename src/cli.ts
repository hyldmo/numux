import { FLAGS, type FlagDef, SUBCOMMANDS, type SubcommandDef } from './cli-flags'
import type { ResolvedNumuxConfig } from './types'
import type { Color } from './utils/color'
import type { ThemePref } from './utils/theme'

export interface ParsedArgs {
	help: boolean
	version: boolean
	debug: boolean
	init: boolean
	validate: boolean
	exec: boolean
	execName?: string
	execCommand?: string
	logs: boolean
	logsProcess?: string
	completions?: string
	prefix: boolean
	tmux: boolean
	killOthers: boolean
	killOthersOnFail: boolean
	timestamps: boolean | string
	noWatch: boolean
	maxRestarts?: number
	autoColors: boolean
	configPath?: string
	logDir?: string
	only?: string[]
	exclude?: string[]
	sort?: string
	colors?: string[]
	workspace?: string
	envFile?: string | false
	theme?: ThemePref
	helpTopic?: string
	commands: string[]
	named: Array<{ name: string; command: string }>
}

// Build lookup maps once
const flagByName = new Map<string, FlagDef>()
for (const f of FLAGS) {
	flagByName.set(f.long, f)
	if (f.short) flagByName.set(f.short, f)
}

const subcommandByName = new Map<string, SubcommandDef>()
for (const s of SUBCOMMANDS) {
	subcommandByName.set(s.name, s)
}

export function parseArgs(argv: string[]): ParsedArgs {
	const result: ParsedArgs = {
		help: false,
		version: false,
		debug: false,
		init: false,
		validate: false,
		exec: false,
		logs: false,
		prefix: false,
		tmux: false,
		killOthers: false,
		killOthersOnFail: false,
		timestamps: false,
		noWatch: false,
		autoColors: false,
		configPath: undefined,
		commands: [],
		named: []
	}

	const args = argv.slice(2) // skip bun + script
	let i = 0

	while (i < args.length) {
		const arg = args[i]
		const flag = flagByName.get(arg)

		if (flag) {
			if (flag.type === 'boolean') {
				;(result as any)[flag.key] = true
			} else if (flag.type === 'optional-value') {
				// Peek at next arg — consume as value if it exists and doesn't look like a flag
				const next = args[i + 1]
				if (next !== undefined && !next.startsWith('-')) {
					;(result as any)[flag.key] = next
					i++
				} else {
					;(result as any)[flag.key] = true
				}
			} else {
				const next = args[++i]
				if (next === undefined) {
					throw new Error(`Missing value for ${arg}`)
				}
				const value = flag.parse ? flag.parse(next, arg) : next
				const current = (result as any)[flag.key]
				if (Array.isArray(current)) {
					if (Array.isArray(value)) current.push(...value)
					else current.push(value)
				} else {
					;(result as any)[flag.key] = value
				}
			}
		} else if (!arg.startsWith('-')) {
			const sub = result.commands.length === 0 ? subcommandByName.get(arg) : undefined
			if (sub) {
				const ret = sub.parse(args, i, result)
				if (ret === 'break') break
				i = ret
			} else {
				result.commands.push(arg)
			}
		} else {
			throw new Error(`Unknown option: ${arg}`)
		}

		i++
	}

	return result
}

const RUNNERS = new Set(['npm', 'npx', 'yarn', 'pnpm', 'bun', 'bunx'])

/** Derive a short process name from a command string. For package runners, uses the last arg (the script name). */
export function deriveProcessName(cmd: string): string {
	const parts = cmd.split(/\s+/)
	const first = parts[0].split('/').pop()!
	if (parts.length > 1 && RUNNERS.has(first)) {
		return parts[parts.length - 1]
	}
	return first
}

export function buildConfigFromArgs(
	commands: string[],
	named: Array<{ name: string; command: string }>,
	options?: { colors?: Color[] }
): ResolvedNumuxConfig {
	const processes: ResolvedNumuxConfig['processes'] = {}
	const colors = options?.colors
	let colorIndex = 0

	for (const { name, command } of named) {
		const color = colors?.[colorIndex++ % colors.length]
		processes[name] = { command, ...(color ? { color } : {}) }
	}

	for (let i = 0; i < commands.length; i++) {
		const cmd = commands[i]
		let name = deriveProcessName(cmd)
		if (processes[name]) {
			name = `${name}-${i}`
		}
		const color = colors?.[colorIndex++ % colors.length]
		processes[name] = { command: cmd, ...(color ? { color } : {}) }
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
