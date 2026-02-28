import type { ParsedArgs } from './cli'

// --- Flag types ---

interface BooleanFlag {
	type: 'boolean'
	long: string
	short?: string
	key: keyof ParsedArgs
	description: string
}

interface ValueFlag {
	type: 'value'
	long: string
	short?: string
	key: keyof ParsedArgs
	description: string
	valueName: string
	completionHint?: 'file' | 'directory' | 'none'
	parse?: (raw: string, flag: string) => unknown
}

export type FlagDef = BooleanFlag | ValueFlag

export interface SubcommandDef {
	name: string
	description: string
	usage?: string
	parse: (args: string[], i: number, result: ParsedArgs) => number | 'break'
}

// --- Helpers ---

const commaSplit = (raw: string): string[] =>
	raw
		.split(',')
		.map(s => s.trim())
		.filter(Boolean)

// --- Definitions ---

export const FLAGS: FlagDef[] = [
	{
		type: 'value',
		long: '--sort',
		short: '-s',
		key: 'sort',
		description: 'Tab display order',
		valueName: '<config|alphabetical|topological>',
		completionHint: 'none'
	},
	{
		type: 'value',
		long: '--workspace',
		short: '-w',
		key: 'workspace',
		description: 'Run a package.json script across all workspaces',
		valueName: '<script>',
		completionHint: 'none'
	},
	{
		type: 'value',
		long: '--name',
		short: '-n',
		key: 'named',
		description: 'Add a named process',
		valueName: '<name=command>',
		completionHint: 'none',
		parse(raw: string) {
			const eq = raw.indexOf('=')
			if (eq < 1) {
				throw new Error(`Invalid --name value: expected "name=command", got "${raw}"`)
			}
			return { name: raw.slice(0, eq), command: raw.slice(eq + 1) }
		}
	},
	{
		type: 'value',
		long: '--color',
		short: '-c',
		key: 'colors',
		description:
			'Comma-separated colors (hex or names: black, red, green, yellow, blue, magenta, cyan, white, gray, orange, purple)',
		valueName: '<colors>',
		completionHint: 'none',
		parse: commaSplit
	},
	{
		type: 'boolean',
		long: '--colors',
		key: 'autoColors',
		description: 'Auto-assign colors to processes based on their name'
	},
	{
		type: 'value',
		long: '--env-file',
		short: '-e',
		key: 'envFile',
		description: 'Env file path, or "false" to disable env file loading',
		valueName: '<path|false>',
		completionHint: 'file',
		parse: (raw: string) => (raw === 'false' ? false : raw)
	},
	{
		type: 'value',
		long: '--config',
		key: 'configPath',
		description: 'Config file path (default: auto-detect)',
		valueName: '<path>',
		completionHint: 'file'
	},
	{
		type: 'boolean',
		long: '--prefix',
		short: '-p',
		key: 'prefix',
		description: 'Prefixed output mode (no TUI, for CI/scripts)'
	},
	{
		type: 'value',
		long: '--only',
		key: 'only',
		description: 'Only run these processes (+ their dependencies)',
		valueName: '<a,b,...>',
		completionHint: 'none',
		parse: commaSplit
	},
	{
		type: 'value',
		long: '--exclude',
		key: 'exclude',
		description: 'Exclude these processes',
		valueName: '<a,b,...>',
		completionHint: 'none',
		parse: commaSplit
	},
	{
		type: 'boolean',
		long: '--kill-others',
		key: 'killOthers',
		description: 'Kill all processes when any exits'
	},
	{
		type: 'value',
		long: '--max-restarts',
		key: 'maxRestarts',
		description: 'Max auto-restarts for crashed processes',
		valueName: '<n>',
		completionHint: 'none',
		parse(raw: string, flag: string) {
			const n = Number(raw)
			if (!Number.isInteger(n) || n < 0) throw new Error(`${flag} must be a non-negative integer, got "${raw}"`)
			return n
		}
	},
	{
		type: 'boolean',
		long: '--no-watch',
		key: 'noWatch',
		description: 'Disable file watching even if config has watch patterns'
	},
	{
		type: 'boolean',
		long: '--timestamps',
		short: '-t',
		key: 'timestamps',
		description: 'Add timestamps to prefixed output lines'
	},
	{
		type: 'value',
		long: '--log-dir',
		key: 'logDir',
		description: 'Write per-process logs to directory',
		valueName: '<path>',
		completionHint: 'directory'
	},
	{
		type: 'boolean',
		long: '--debug',
		key: 'debug',
		description: 'Enable debug logging to .numux/debug.log'
	},
	{
		type: 'boolean',
		long: '--help',
		short: '-h',
		key: 'help',
		description: 'Show this help'
	},
	{
		type: 'boolean',
		long: '--version',
		short: '-v',
		key: 'version',
		description: 'Show version'
	}
]

export const SUBCOMMANDS: SubcommandDef[] = [
	{
		name: 'init',
		description: 'Create a starter config file',
		parse: (_args, i, result) => {
			result.init = true
			return i
		}
	},
	{
		name: 'validate',
		description: 'Validate config and show process graph',
		parse: (_args, i, result) => {
			result.validate = true
			return i
		}
	},
	{
		name: 'exec',
		description: "Run a command in a process's environment",
		usage: 'exec <name> [--] <cmd>',
		parse: (args, i, result) => {
			result.exec = true
			const name = args[++i]
			if (!name) throw new Error('exec requires a process name')
			result.execName = name
			if (args[i + 1] === '--') i++
			const rest = args.slice(i + 1)
			if (rest.length === 0) throw new Error('exec requires a command to run')
			result.execCommand = rest.join(' ')
			return 'break'
		}
	},
	{
		name: 'completions',
		description: 'Generate shell completions (bash, zsh, fish)',
		usage: 'completions <shell>',
		parse: (args, i, result) => {
			const next = args[++i]
			if (next === undefined) throw new Error('Missing value for completions')
			result.completions = next
			return i
		}
	}
]

// --- Help text generator ---

export function generateHelp(): string {
	const lines = [
		'numux \u2014 terminal multiplexer with dependency orchestration',
		'',
		'Usage:',
		'  numux                          Run processes from config file',
		'  numux <cmd1> <cmd2> ...        Run ad-hoc commands in parallel',
		'  numux -n name1=cmd1 -n name2=cmd2  Named ad-hoc commands',
		'  numux -w <script>              Run a script across all workspaces'
	]

	for (const sub of SUBCOMMANDS) {
		const label = `  numux ${sub.usage ?? sub.name}`
		lines.push(`${label.padEnd(33)}${sub.description}`)
	}

	lines.push('', 'Options:')

	for (const f of FLAGS) {
		const parts: string[] = []
		if (f.short) parts.push(`${f.short},`)
		parts.push(f.long)
		if (f.type === 'value') parts.push(f.valueName)
		const left = `  ${parts.join(' ')}`
		lines.push(`${left.padEnd(29)}${f.description}`)
	}

	lines.push('', 'Config files (auto-detected):', '  numux.config.ts, numux.config.js')

	return lines.join('\n')
}
