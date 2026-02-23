export interface NumuxProcessConfig {
	command: string
	cwd?: string
	env?: Record<string, string>
	envFile?: string | string[] // .env file path(s) to load
	dependsOn?: string[]
	readyPattern?: string
	persistent?: boolean // default true, false = one-shot
	maxRestarts?: number // default Infinity, limit auto-restart attempts
	readyTimeout?: number // ms to wait for readyPattern before failing (default: none)
	stopSignal?: 'SIGTERM' | 'SIGINT' | 'SIGHUP' // signal for graceful stop (default: SIGTERM)
	color?: string
}

/** Raw config as authored — processes can be string shorthand or full objects */
export interface NumuxConfig {
	processes: Record<string, NumuxProcessConfig | string>
}

/** Validated config with all shorthand expanded to full objects */
export interface ResolvedNumuxConfig {
	processes: Record<string, NumuxProcessConfig>
}

export type ProcessStatus = 'pending' | 'starting' | 'ready' | 'running' | 'stopping' | 'stopped' | 'failed' | 'skipped'

export interface ProcessState {
	name: string
	config: NumuxProcessConfig
	status: ProcessStatus
	exitCode: number | null
	restartCount: number
}

export type ProcessEvent =
	| { type: 'status'; name: string; status: ProcessStatus }
	| { type: 'output'; name: string; data: Uint8Array }
	| { type: 'exit'; name: string; code: number | null }
