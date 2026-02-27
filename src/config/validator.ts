import type { ResolvedNumuxConfig, ResolvedProcessConfig } from '../types'
import { isValidColor } from '../utils/color'

export type ValidationWarning = { process: string; message: string }

export function validateConfig(raw: unknown, warnings?: ValidationWarning[]): ResolvedNumuxConfig {
	if (!raw || typeof raw !== 'object') {
		throw new Error('Config must be an object')
	}

	const config = raw as Record<string, unknown>
	if (!config.processes || typeof config.processes !== 'object') {
		throw new Error('Config must have a "processes" object')
	}

	const processes = config.processes as Record<string, unknown>
	const names = Object.keys(processes)

	if (names.length === 0) {
		throw new Error('Config must define at least one process')
	}

	// Extract global options
	const globalCwd = typeof config.cwd === 'string' ? config.cwd : undefined
	const globalShowCommand = typeof config.showCommand === 'boolean' ? config.showCommand : undefined
	const globalEnvFile = validateEnvFile(config.envFile)
	let globalEnv: Record<string, string> | undefined
	if (config.env && typeof config.env === 'object') {
		for (const [k, v] of Object.entries(config.env as Record<string, unknown>)) {
			if (typeof v !== 'string') {
				throw new Error(`env.${k} must be a string, got ${typeof v}`)
			}
		}
		globalEnv = config.env as Record<string, string>
	}

	const validated: Record<string, ResolvedProcessConfig> = {}

	for (const name of names) {
		let proc = processes[name]

		// String shorthand: "command" → { command: "command" }
		if (typeof proc === 'string') {
			proc = { command: proc }
		}

		if (!proc || typeof proc !== 'object') {
			throw new Error(`Process "${name}" must be an object or a command string`)
		}

		const p = proc as Record<string, unknown>

		if (typeof p.command !== 'string' || !p.command.trim()) {
			throw new Error(`Process "${name}" must have a non-empty "command" string`)
		}

		// Validate dependsOn references
		if (p.dependsOn !== undefined) {
			if (typeof p.dependsOn === 'string') p.dependsOn = [p.dependsOn]
			if (!Array.isArray(p.dependsOn)) {
				throw new Error(`Process "${name}".dependsOn must be a string or array`)
			}
			for (const dep of p.dependsOn) {
				if (typeof dep !== 'string') {
					throw new Error(`Process "${name}".dependsOn entries must be strings`)
				}
				if (!names.includes(dep)) {
					throw new Error(`Process "${name}" depends on unknown process "${dep}"`)
				}
				if (dep === name) {
					throw new Error(`Process "${name}" cannot depend on itself`)
				}
			}
		}

		// Validate color (hex or basic name: green, cyan, magenta, red, yellow, blue)
		if (typeof p.color === 'string') {
			if (!isValidColor(p.color)) {
				throw new Error(
					`Process "${name}".color must be a hex color (e.g. "#ff8800") or basic name (black, red, green, yellow, blue, magenta, cyan, white, gray, orange, purple), got "${p.color}"`
				)
			}
		} else if (Array.isArray(p.color)) {
			for (const c of p.color) {
				if (typeof c !== 'string' || !isValidColor(c)) {
					throw new Error(
						`Process "${name}".color entries must be hex or basic names (black, red, green, yellow, blue, magenta, cyan, white, gray, orange), got "${c}"`
					)
				}
			}
		}

		const persistent = typeof p.persistent === 'boolean' ? p.persistent : true
		const readyPattern =
			p.readyPattern instanceof RegExp
				? p.readyPattern
				: typeof p.readyPattern === 'string'
					? p.readyPattern
					: undefined

		if (typeof readyPattern === 'string') {
			try {
				new RegExp(readyPattern)
			} catch (err) {
				throw new Error(`Process "${name}".readyPattern is not a valid regex: "${readyPattern}"`, {
					cause: err
				})
			}
		}

		// Warn when readyPattern is set on non-persistent processes (it's ignored at runtime)
		if (readyPattern && !persistent) {
			warnings?.push({
				process: name,
				message: 'readyPattern is ignored on non-persistent processes (readiness is determined by exit code)'
			})
		}

		// Validate env values are strings
		if (p.env && typeof p.env === 'object') {
			for (const [k, v] of Object.entries(p.env as Record<string, unknown>)) {
				if (typeof v !== 'string') {
					throw new Error(`Process "${name}".env.${k} must be a string, got ${typeof v}`)
				}
			}
		}

		const processCwd = typeof p.cwd === 'string' ? p.cwd : undefined
		const processEnv = p.env && typeof p.env === 'object' ? (p.env as Record<string, string>) : undefined
		const processEnvFile = validateEnvFile(p.envFile)

		const showCommand = typeof p.showCommand === 'boolean' ? p.showCommand : (globalShowCommand ?? true)

		const platform = validatePlatform(name, p.platform)

		validated[name] = {
			command: p.command,
			cwd: processCwd ?? globalCwd,
			env: globalEnv || processEnv ? { ...globalEnv, ...processEnv } : undefined,
			envFile: processEnvFile ?? globalEnvFile,
			dependsOn: Array.isArray(p.dependsOn) ? (p.dependsOn as string[]) : undefined,
			readyPattern,
			persistent,
			maxRestarts: typeof p.maxRestarts === 'number' && p.maxRestarts >= 0 ? p.maxRestarts : undefined,
			readyTimeout: typeof p.readyTimeout === 'number' && p.readyTimeout > 0 ? p.readyTimeout : undefined,
			delay: typeof p.delay === 'number' && p.delay > 0 ? p.delay : undefined,
			condition: typeof p.condition === 'string' && p.condition.trim() ? p.condition.trim() : undefined,
			platform,
			stopSignal: validateStopSignal(p.stopSignal),
			color: typeof p.color === 'string' ? p.color : Array.isArray(p.color) ? (p.color as string[]) : undefined,
			watch: validateStringOrStringArray(p.watch),
			interactive: typeof p.interactive === 'boolean' ? p.interactive : false,
			errorMatcher: validateErrorMatcher(name, p.errorMatcher),
			showCommand
		}
	}

	return { processes: validated }
}

function validateStringOrStringArray(value: unknown): string | string[] | undefined {
	if (typeof value === 'string') return value
	if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value as string[]
	return undefined
}

function validateEnvFile(value: unknown): string | string[] | false | undefined {
	if (value === false) return false
	return validateStringOrStringArray(value)
}

function validateErrorMatcher(name: string, value: unknown): boolean | string | undefined {
	if (value === true) return true
	if (typeof value === 'string' && value.trim()) {
		try {
			new RegExp(value)
		} catch (err) {
			throw new Error(`Process "${name}".errorMatcher is not a valid regex: "${value}"`, { cause: err })
		}
		return value
	}
	if (value !== undefined && value !== false) {
		throw new Error(`Process "${name}".errorMatcher must be true or a regex string`)
	}
	return undefined
}

const VALID_PLATFORMS = new Set(['aix', 'darwin', 'freebsd', 'linux', 'openbsd', 'sunos', 'win32'])

function validatePlatform(name: string, value: unknown): string | string[] | undefined {
	const arr = validateStringOrStringArray(value)
	if (arr === undefined) return undefined
	const values = typeof arr === 'string' ? [arr] : arr
	for (const v of values) {
		if (!VALID_PLATFORMS.has(v)) {
			throw new Error(
				`Process "${name}".platform "${v}" is not valid. Must be one of: ${[...VALID_PLATFORMS].join(', ')}`
			)
		}
	}
	return arr
}

const VALID_STOP_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP'])

function validateStopSignal(value: unknown): 'SIGTERM' | 'SIGINT' | 'SIGHUP' | undefined {
	if (typeof value === 'string' && VALID_STOP_SIGNALS.has(value)) {
		return value as 'SIGTERM' | 'SIGINT' | 'SIGHUP'
	}
	return undefined
}
