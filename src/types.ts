export interface NumuxProcessConfig {
	command: string
	cwd?: string
	env?: Record<string, string>
	envFile?: string | string[] | false // .env file path(s) to load, or false to disable
	dependsOn?: string[]
	readyPattern?: string
	persistent?: boolean // default true, false = one-shot
	maxRestarts?: number // default Infinity, limit auto-restart attempts
	readyTimeout?: number // ms to wait for readyPattern before failing (default: none)
	delay?: number // ms to wait before starting the process (default: none)
	condition?: string // env var name (prefix with ! to negate); process skipped if condition is falsy
	stopSignal?: 'SIGTERM' | 'SIGINT' | 'SIGHUP' // signal for graceful stop (default: SIGTERM)
	color?: string | string[]
	watch?: string | string[] // Glob patterns — restart process when matching files change
	interactive?: boolean // default false — when true, keyboard input is forwarded to the process
	errorMatcher?: boolean | string // true = detect ANSI red, string = regex pattern
	showCommand?: boolean // default true — print the command being run as the first line of output
}

/** Config for npm: wildcard entries — command is derived from package.json scripts */
export type NumuxScriptPattern = Omit<NumuxProcessConfig, 'command'> & { command?: never }

/** Raw config as authored — processes can be string shorthand, full objects, or wildcard patterns */
export interface NumuxConfig {
	cwd?: string // Global working directory, inherited by all processes
	env?: Record<string, string> // Global env vars, merged into each process (process-level overrides)
	envFile?: string | string[] | false // Global .env file(s), inherited by processes without their own envFile; false disables
	showCommand?: boolean // Global showCommand flag, inherited by all processes (default: true)
	processes: Record<string, NumuxProcessConfig | NumuxScriptPattern | string>
}

/** Validated config with all shorthand expanded to full objects */
export interface ResolvedNumuxConfig {
	processes: Record<string, NumuxProcessConfig>
}

export type ProcessStatus =
	| 'pending'
	| 'starting'
	| 'ready'
	| 'running'
	| 'stopping'
	| 'stopped'
	| 'finished'
	| 'failed'
	| 'skipped'

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
	| { type: 'error'; name: string }
