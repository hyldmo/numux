export interface NumuxProcessConfig {
	command: string
	cwd?: string
	env?: Record<string, string>
	dependsOn?: string[]
	readyPattern?: string
	persistent?: boolean // default true, false = one-shot
	maxRestarts?: number // default Infinity, limit auto-restart attempts
	readyTimeout?: number // ms to wait for readyPattern before failing (default: none)
	color?: string
}

export interface NumuxConfig {
	processes: Record<string, NumuxProcessConfig>
}

export type ProcessStatus = 'pending' | 'starting' | 'ready' | 'running' | 'stopping' | 'stopped' | 'failed' | 'skipped'

export interface ProcessState {
	name: string
	config: NumuxProcessConfig
	status: ProcessStatus
	exitCode: number | null
}

export type ProcessEvent =
	| { type: 'status'; name: string; status: ProcessStatus }
	| { type: 'output'; name: string; data: Uint8Array }
	| { type: 'exit'; name: string; code: number | null }
