import { resolve } from 'node:path'
import type { NumuxProcessConfig, ProcessStatus } from '../types'
import { log } from '../utils/logger'
import { createReadinessChecker } from './ready'

export type RunnerEventHandler = {
	onStatus: (status: ProcessStatus) => void
	onOutput: (data: Uint8Array) => void
	onExit: (code: number | null) => void
	onReady: () => void
}

export class ProcessRunner {
	readonly name: string
	private config: NumuxProcessConfig
	private handler: RunnerEventHandler
	private proc: ReturnType<typeof Bun.spawn> | null = null
	private readiness: ReturnType<typeof createReadinessChecker>
	private _ready = false
	private decoder = new TextDecoder()

	constructor(name: string, config: NumuxProcessConfig, handler: RunnerEventHandler) {
		this.name = name
		this.config = config
		this.handler = handler
		this.readiness = createReadinessChecker(config)
	}

	get isReady(): boolean {
		return this._ready
	}

	start(cols: number, rows: number): void {
		log(`[${this.name}] Starting: ${this.config.command}`)
		this.handler.onStatus('starting')

		const env: Record<string, string> = {
			...(process.env as Record<string, string>),
			FORCE_COLOR: '1',
			TERM: 'xterm-256color',
			...this.config.env
		}

		const cwd = this.config.cwd ? resolve(this.config.cwd) : process.cwd()

		this.proc = Bun.spawn(['sh', '-c', this.config.command], {
			cwd,
			env,
			terminal: {
				cols,
				rows,
				data: (_terminal, data) => {
					this.handler.onOutput(data)
					this.checkReadiness(data)
				}
			}
		})

		this.handler.onStatus(this.config.persistent !== false ? 'running' : 'starting')

		if (this.readiness.isImmediatelyReady) {
			this.markReady()
		}

		this.proc.exited.then(code => {
			log(`[${this.name}] Exited with code ${code}`)

			if (this.readiness.dependsOnExit && code === 0) {
				this.markReady()
			}

			const status: ProcessStatus = code === 0 ? 'stopped' : 'failed'
			this.handler.onStatus(status)
			this.handler.onExit(code)
		})
	}

	private checkReadiness(data: Uint8Array): void {
		if (this._ready) return
		const text = this.decoder.decode(data, { stream: true })
		if (this.readiness.feedOutput(text)) {
			this.markReady()
		}
	}

	private markReady(): void {
		if (this._ready) return
		this._ready = true
		log(`[${this.name}] Ready`)
		this.handler.onStatus('ready')
		this.handler.onReady()
	}

	async restart(cols: number, rows: number): Promise<void> {
		log(`[${this.name}] Restarting`)
		if (this.proc) {
			this.handler.onStatus('stopping')
			this.proc.kill('SIGTERM')
			await Promise.race([this.proc.exited, new Promise<void>(r => setTimeout(r, 2000))])
			if (this.proc) {
				this.proc.kill('SIGKILL')
			}
		}
		this.proc = null
		this._ready = false
		this.readiness = createReadinessChecker(this.config)
		this.start(cols, rows)
	}

	async stop(timeoutMs = 5000): Promise<void> {
		if (!this.proc) return

		log(`[${this.name}] Stopping (timeout: ${timeoutMs}ms)`)
		this.handler.onStatus('stopping')
		this.proc.kill('SIGTERM')

		const exited = Promise.race([
			this.proc.exited,
			new Promise<'timeout'>(r => setTimeout(() => r('timeout'), timeoutMs))
		])

		const result = await exited
		if (result === 'timeout') {
			this.proc.kill('SIGKILL')
			await this.proc.exited
		}

		this.proc = null
	}

	resize(cols: number, rows: number): void {
		if (this.proc?.terminal) {
			this.proc.terminal.resize(cols, rows)
		}
	}

	write(data: string): void {
		if (this.proc?.terminal) {
			this.proc.terminal.write(data)
		}
	}
}
