export interface NumuxProcessConfig<K extends string = string> {
	/** Shell command to run. Supports `$dep.group` references from dependency capture groups */
	command: string
	/** Working directory for the process */
	cwd?: string
	/**
	 * Extra environment variables. Values support `$dep.group` references
	 * from dependency capture groups.
	 * @example { DB_PORT: '$db.port' }
	 */
	env?: Record<string, string>
	/** .env file path(s) to load, or `false` to disable */
	envFile?: string | string[] | false
	/** Processes that must be ready before this one starts */
	dependsOn?: NoInfer<K> | NoInfer<K>[]
	/** Regex matched against stdout to signal readiness. Use `RegExp` to capture groups for `$dep.group` expansion */
	readyPattern?: string | RegExp
	/**
	 * Set to `false` for one-shot processes
	 * @default true
	 */
	persistent?: boolean
	/**
	 * Limit auto-restart attempts
	 * @default Infinity
	 */
	maxRestarts?: number
	/** Milliseconds to wait for readyPattern before failing */
	readyTimeout?: number
	/** Milliseconds to wait before starting the process */
	delay?: number
	/** Env var name (prefix with `!` to negate); process skipped if condition is falsy */
	condition?: string
	/** OS(es) this process runs on (e.g. `'darwin'`, `'linux'`). Non-matching processes are removed, their dependents still start */
	platform?: string | string[]
	/**
	 * Signal for graceful stop
	 * @default 'SIGTERM'
	 */
	stopSignal?: 'SIGTERM' | 'SIGINT' | 'SIGHUP'
	/** Hex color (e.g. `"#ff6600"`) or color name. Array for round-robin in script patterns */
	color?: string | string[]
	/** Glob patterns — restart process when matching files change */
	watch?: string | string[]
	/**
	 * When true, keyboard input is forwarded to the process
	 * @default false
	 */
	interactive?: boolean
	/** `true` = detect ANSI red output, string = regex pattern */
	errorMatcher?: boolean | string
	/**
	 * Print the command being run as the first line of output
	 * @default true
	 */
	showCommand?: boolean
}

/** Config for npm: wildcard entries — command is derived from package.json scripts */
export type NumuxScriptPattern<K extends string = string> = Omit<NumuxProcessConfig<K>, 'command'> & { command?: never }

/** Raw config as authored — processes can be string shorthand, full objects, or wildcard patterns */
export interface NumuxConfig<K extends string = string> {
	/** Global working directory, inherited by all processes */
	cwd?: string
	/** Global env vars, merged into each process (process-level overrides) */
	env?: Record<string, string>
	/** Global .env file(s), inherited by processes without their own envFile; `false` disables */
	envFile?: string | string[] | false
	/**
	 * Global showCommand flag, inherited by all processes
	 * @default true
	 */
	showCommand?: boolean
	/**
	 * Tab display order. `'config'` preserves definition order (package.json script order for wildcards),
	 * `'alphabetical'` sorts by process name, `'topological'` sorts by dependency tiers.
	 * @default 'config'
	 */
	sort?: SortOrder
	processes: Record<K, NumuxProcessConfig<K> | NumuxScriptPattern<K> | string>
}

export type SortOrder = 'config' | 'alphabetical' | 'topological'

/** Process config after validation — dependsOn is always normalized to an array */
export interface ResolvedProcessConfig extends Omit<NumuxProcessConfig, 'dependsOn'> {
	dependsOn?: string[]
}

/** Validated config with all shorthand expanded to full objects */
export interface ResolvedNumuxConfig {
	sort?: SortOrder
	processes: Record<string, ResolvedProcessConfig>
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
	config: ResolvedProcessConfig
	status: ProcessStatus
	exitCode: number | null
	restartCount: number
}

export type ProcessEvent =
	| { type: 'status'; name: string; status: ProcessStatus }
	| { type: 'output'; name: string; data: Uint8Array }
	| { type: 'exit'; name: string; code: number | null }
	| { type: 'error'; name: string }
