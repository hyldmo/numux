import { resolve } from 'node:path'
import type { ProcessStatus, ResolvedProcessConfig } from '../types'
import { loadEnvFiles } from '../utils/env-file'
import { log } from '../utils/logger'
import { createErrorChecker } from './error'
import { createReadinessChecker } from './ready'

export type RunnerEventHandler = {
	onStatus: (status: ProcessStatus) => void
	onOutput: (data: Uint8Array) => void
	onExit: (code: number | null) => void
	onReady: (captures?: Record<string, string> | null) => void
	onError: () => void
}

export class ProcessRunner {
	readonly name: string
	private config: ResolvedProcessConfig
	private handler: RunnerEventHandler
	private proc: ReturnType<typeof Bun.spawn> | null = null
	private readiness: ReturnType<typeof createReadinessChecker>
	private errorChecker: ReturnType<typeof createErrorChecker>
	private _ready = false
	private stopping = false
	private decoder = new TextDecoder()
	private errorDecoder = new TextDecoder()
	private generation = 0
	private readyTimer: ReturnType<typeof setTimeout> | null = null
	private restarting = false
	private readyTimedOut = false
	private commandOverride: string | undefined
	private envOverride: Record<string, string> | undefined

	constructor(name: string, config: ResolvedProcessConfig, handler: RunnerEventHandler) {
		this.name = name
		this.config = config
		this.handler = handler
		this.readiness = createReadinessChecker(config)
		this.errorChecker = createErrorChecker(config)
	}

	get isReady(): boolean {
		return this._ready
	}

	private get signal(): NodeJS.Signals {
		return this.config.stopSignal ?? 'SIGTERM'
	}

	start(cols: number, rows: number, commandOverride?: string, envOverride?: Record<string, string>): void {
		if (commandOverride !== undefined) this.commandOverride = commandOverride
		if (envOverride !== undefined) this.envOverride = envOverride
		const command = this.commandOverride ?? this.config.command
		const gen = ++this.generation
		this.stopping = false
		log(`[${this.name}] Starting (gen ${gen}): ${command}`)
		this.handler.onStatus('starting')

		const cwd = this.config.cwd ? resolve(this.config.cwd) : process.cwd()

		try {
			const envFromFile = this.config.envFile ? loadEnvFiles(this.config.envFile, cwd) : {}
			const noColor = 'NO_COLOR' in process.env
			const env: Record<string, string> = {
				...(process.env as Record<string, string>),
				...(noColor ? {} : { FORCE_COLOR: '1' }),
				TERM: 'xterm-256color',
				...envFromFile,
				...(this.envOverride ?? this.config.env)
			}

			this.proc = Bun.spawn(['sh', '-c', command], {
				cwd,
				env,
				terminal: {
					cols,
					rows,
					data: (_terminal, data) => {
						if (this.generation !== gen) return
						this.handler.onOutput(data)
						this.checkReadiness(data)
						this.checkError(data)
					}
				}
			})
		} catch (err) {
			log(`[${this.name}] Spawn failed: ${err}`)
			const encoder = new TextEncoder()
			const msg = `\r\n\x1b[31m[numux] failed to start: ${err instanceof Error ? err.message : err}\x1b[0m\r\n`
			this.handler.onOutput(encoder.encode(msg))
			this.handler.onStatus('failed')
			this.handler.onExit(null)
			return
		}

		if (this.config.showCommand !== false) {
			const encoder = new TextEncoder()
			const msg = `\x1b[2m$ ${command}\x1b[0m\r\n\r\n`
			this.handler.onOutput(encoder.encode(msg))
		}

		this.handler.onStatus(this.config.readyPattern ? 'running' : 'starting')

		this.startReadyTimeout(gen)

		this.proc.exited
			.then(code => {
				if (this.generation !== gen) return
				log(`[${this.name}] Exited with code ${code}`)

				if (this.readiness.dependsOnExit && code === 0) {
					this.markReady()
				}

				if (code === 127 || code === 126) {
					const encoder = new TextEncoder()
					const hint = code === 127 ? 'command not found' : 'permission denied'
					const msg = `\r\n\x1b[31m[numux] exit ${code}: ${hint}\x1b[0m\r\n`
					this.handler.onOutput(encoder.encode(msg))
				}

				// Suppress exit events when the process is being restarted or when
				// readyTimeout already marked it as failed, to avoid unintended
				// auto-restart scheduling.
				if (!(this.readyTimedOut || this.restarting)) {
					const status: ProcessStatus = this.stopping ? 'stopped' : code === 0 ? 'finished' : 'failed'
					this.handler.onStatus(status)
					this.handler.onExit(code)
				}
			})
			.catch(err => {
				if (this.generation !== gen) return
				log(`[${this.name}] proc.exited rejected: ${err}`)
				this.handler.onStatus('failed')
				this.handler.onExit(null)
			})
	}

	private checkReadiness(data: Uint8Array): void {
		if (this._ready) return
		const text = this.decoder.decode(data, { stream: true })
		if (this.readiness.feedOutput(text)) {
			this.markReady()
		}
	}

	private checkError(data: Uint8Array): void {
		if (!this.errorChecker) return
		const text = this.errorDecoder.decode(data, { stream: true })
		if (this.errorChecker.feedOutput(text)) {
			this.handler.onError()
		}
	}

	private startReadyTimeout(gen: number): void {
		const timeout = this.config.readyTimeout
		if (!(timeout && this.config.readyPattern)) return

		this.readyTimer = setTimeout(() => {
			this.readyTimer = null
			if (this.generation !== gen || this._ready) return
			this.readyTimedOut = true
			log(`[${this.name}] Ready timeout after ${timeout}ms`)
			const encoder = new TextEncoder()
			const msg = `\r\n\x1b[31m[numux] readyPattern not matched within ${(timeout / 1000).toFixed(0)}s — marking as failed\x1b[0m\r\n`
			this.handler.onOutput(encoder.encode(msg))
			this.handler.onStatus('failed')
			this.handler.onReady() // unblock the dependency tier
		}, timeout)
	}

	private clearReadyTimeout(): void {
		if (this.readyTimer) {
			clearTimeout(this.readyTimer)
			this.readyTimer = null
		}
	}

	private markReady(): void {
		if (this._ready) return
		this._ready = true
		this.clearReadyTimeout()
		log(`[${this.name}] Ready`)
		this.handler.onStatus('ready')
		this.handler.onReady(this.readiness.captures)
	}

	async restart(
		cols: number,
		rows: number,
		commandOverride?: string,
		envOverride?: Record<string, string>
	): Promise<void> {
		if (this.restarting) return
		this.restarting = true
		log(`[${this.name}] Restarting`)
		this.clearReadyTimeout()
		if (this.proc) {
			this.stopping = true
			this.handler.onStatus('stopping')
			this.killProcessGroup(this.signal)
			const result = await Promise.race([
				this.proc.exited.then(() => 'exited' as const),
				new Promise<'timeout'>(r => setTimeout(() => r('timeout'), 2000))
			])
			if (result === 'timeout' && this.proc) {
				this.killProcessGroup('SIGKILL')
				await this.proc.exited
			}
		}
		this.proc = null
		this._ready = false
		this.restarting = false
		this.readyTimedOut = false
		this.readiness = createReadinessChecker(this.config)
		this.errorChecker = createErrorChecker(this.config)
		this.start(cols, rows, commandOverride, envOverride)
	}

	async stop(timeoutMs = 5000): Promise<void> {
		if (!this.proc) return

		this.clearReadyTimeout()
		this.stopping = true
		log(`[${this.name}] Stopping (timeout: ${timeoutMs}ms)`)
		this.handler.onStatus('stopping')
		this.killProcessGroup(this.signal)

		const exited = Promise.race([
			this.proc.exited,
			new Promise<'timeout'>(r => setTimeout(() => r('timeout'), timeoutMs))
		])

		const result = await exited
		if (result === 'timeout') {
			this.killProcessGroup('SIGKILL')
			await this.proc.exited
		}

		this.proc = null
	}

	/** Signal the entire process group (child + its descendants), falling back to direct PID */
	private killProcessGroup(sig: NodeJS.Signals): void {
		if (!this.proc) return
		try {
			// Negative PID signals the entire process group
			process.kill(-this.proc.pid, sig)
		} catch {
			// Process group may not exist; fall back to direct kill
			try {
				this.proc.kill(sig)
			} catch {
				// Process already exited
			}
		}
	}

	resize(cols: number, rows: number): void {
		if (this.proc?.terminal) {
			this.proc.terminal.resize(cols, rows)
		}
	}

	write(data: string): void {
		if (this.config.interactive && this.proc?.terminal) {
			this.proc.terminal.write(data)
		}
	}
}
