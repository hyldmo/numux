import type { NumuxConfig, NumuxProcessConfig } from '../types'

export function validateConfig(raw: unknown): NumuxConfig {
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

	const validated: Record<string, NumuxProcessConfig> = {}

	for (const name of names) {
		const proc = processes[name]
		if (!proc || typeof proc !== 'object') {
			throw new Error(`Process "${name}" must be an object`)
		}

		const p = proc as Record<string, unknown>

		if (typeof p.command !== 'string' || !p.command.trim()) {
			throw new Error(`Process "${name}" must have a non-empty "command" string`)
		}

		// Validate dependsOn references
		if (p.dependsOn !== undefined) {
			if (!Array.isArray(p.dependsOn)) {
				throw new Error(`Process "${name}".dependsOn must be an array`)
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

		validated[name] = {
			command: p.command,
			cwd: typeof p.cwd === 'string' ? p.cwd : undefined,
			env: p.env && typeof p.env === 'object' ? (p.env as Record<string, string>) : undefined,
			envFile: validateEnvFile(p.envFile),
			dependsOn: Array.isArray(p.dependsOn) ? (p.dependsOn as string[]) : undefined,
			readyPattern: typeof p.readyPattern === 'string' ? p.readyPattern : undefined,
			persistent: typeof p.persistent === 'boolean' ? p.persistent : true,
			maxRestarts: typeof p.maxRestarts === 'number' && p.maxRestarts >= 0 ? p.maxRestarts : undefined,
			readyTimeout: typeof p.readyTimeout === 'number' && p.readyTimeout > 0 ? p.readyTimeout : undefined,
			stopSignal: validateStopSignal(p.stopSignal),
			color: typeof p.color === 'string' ? p.color : undefined
		}
	}

	return { processes: validated }
}

function validateEnvFile(value: unknown): string | string[] | undefined {
	if (typeof value === 'string') return value
	if (Array.isArray(value) && value.every(v => typeof v === 'string')) return value as string[]
	return undefined
}

const VALID_STOP_SIGNALS = new Set(['SIGTERM', 'SIGINT', 'SIGHUP'])

function validateStopSignal(value: unknown): 'SIGTERM' | 'SIGINT' | 'SIGHUP' | undefined {
	if (typeof value === 'string' && VALID_STOP_SIGNALS.has(value)) {
		return value as 'SIGTERM' | 'SIGINT' | 'SIGHUP'
	}
	return undefined
}
