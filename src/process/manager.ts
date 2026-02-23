import { resolveDependencyTiers } from '../config/resolver'
import type { NumuxConfig, ProcessEvent, ProcessState, ProcessStatus } from '../types'
import { log } from '../utils/logger'
import { ProcessRunner } from './runner'

type EventListener = (event: ProcessEvent) => void

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30_000
const BACKOFF_RESET_MS = 10_000

export class ProcessManager {
	private config: NumuxConfig
	private runners = new Map<string, ProcessRunner>()
	private states = new Map<string, ProcessState>()
	private tiers: string[][]
	private listeners: EventListener[] = []
	private stopping = false
	private lastCols = 80
	private lastRows = 24
	private restartAttempts = new Map<string, number>()
	private restartTimers = new Map<string, ReturnType<typeof setTimeout>>()
	private startTimes = new Map<string, number>()

	constructor(config: NumuxConfig) {
		this.config = config
		this.tiers = resolveDependencyTiers(config)
		log(`Resolved ${this.tiers.length} dependency tiers:`, this.tiers)

		for (const [name, proc] of Object.entries(config.processes)) {
			this.states.set(name, {
				name,
				config: proc,
				status: 'pending',
				exitCode: null
			})
		}
	}

	on(listener: EventListener): void {
		this.listeners.push(listener)
	}

	private emit(event: ProcessEvent): void {
		for (const listener of this.listeners) {
			listener(event)
		}
	}

	getState(name: string): ProcessState | undefined {
		return this.states.get(name)
	}

	getAllStates(): ProcessState[] {
		return [...this.states.values()]
	}

	/** Names in display order (topological) */
	getProcessNames(): string[] {
		return this.tiers.flat()
	}

	async startAll(cols: number, rows: number): Promise<void> {
		log('Starting all processes')
		this.lastCols = cols
		this.lastRows = rows

		for (const tier of this.tiers) {
			const readyPromises: Promise<void>[] = []

			for (const name of tier) {
				// Check if any dependency failed
				const deps = this.config.processes[name].dependsOn ?? []
				const failedDep = deps.find(d => {
					const s = this.states.get(d)!.status
					return s === 'failed' || s === 'skipped'
				})

				if (failedDep) {
					log(`Skipping ${name}: dependency ${failedDep} failed`)
					this.updateStatus(name, 'skipped')
					continue
				}

				const { promise, resolve } = Promise.withResolvers<void>()
				readyPromises.push(promise)

				this.createRunner(name, resolve)
				this.runners.get(name)!.start(cols, rows)
				this.startTimes.set(name, Date.now())
			}

			// Wait for all processes in this tier to become ready
			if (readyPromises.length > 0) {
				await Promise.all(readyPromises)
			}
		}
	}

	private createRunner(name: string, onInitialReady?: () => void): void {
		let readyResolved = !onInitialReady
		const runner = new ProcessRunner(name, this.config.processes[name], {
			onStatus: status => this.updateStatus(name, status),
			onOutput: data => this.emit({ type: 'output', name, data }),
			onExit: code => {
				const state = this.states.get(name)!
				state.exitCode = code
				this.emit({ type: 'exit', name, code })
				if (!readyResolved) {
					readyResolved = true
					onInitialReady!()
				}
				this.scheduleAutoRestart(name, code)
			},
			onReady: () => {
				if (!readyResolved) {
					readyResolved = true
					onInitialReady!()
				}
			}
		})
		this.runners.set(name, runner)
	}

	private scheduleAutoRestart(name: string, exitCode: number | null): void {
		if (this.stopping) return
		const proc = this.config.processes[name]
		if (proc.persistent === false) return
		if (exitCode === 0) return
		log(`Scheduling auto-restart for ${name} (exit code: ${exitCode})`)

		// Reset backoff if the process ran long enough
		const startTime = this.startTimes.get(name) ?? 0
		if (Date.now() - startTime > BACKOFF_RESET_MS) {
			this.restartAttempts.set(name, 0)
		}

		const attempt = this.restartAttempts.get(name) ?? 0
		const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS)
		this.restartAttempts.set(name, attempt + 1)

		const encoder = new TextEncoder()
		const msg = `\r\n\x1b[33m[numux] restarting in ${(delay / 1000).toFixed(0)}s (attempt ${attempt + 1})...\x1b[0m\r\n`
		this.emit({ type: 'output', name, data: encoder.encode(msg) })

		const timer = setTimeout(() => {
			this.restartTimers.delete(name)
			if (this.stopping) return
			const runner = this.runners.get(name)
			if (!runner) return
			this.startTimes.set(name, Date.now())
			runner.restart(this.lastCols, this.lastRows)
		}, delay)
		this.restartTimers.set(name, timer)
	}

	private updateStatus(name: string, status: ProcessStatus): void {
		const state = this.states.get(name)!
		state.status = status
		this.emit({ type: 'status', name, status })
	}

	restart(name: string, cols: number, rows: number): void {
		const state = this.states.get(name)
		if (!state) return
		if (state.status !== 'stopped' && state.status !== 'failed') return

		const runner = this.runners.get(name)
		if (!runner) return

		// Cancel pending auto-restart and reset backoff
		const timer = this.restartTimers.get(name)
		if (timer) {
			clearTimeout(timer)
			this.restartTimers.delete(name)
		}
		this.restartAttempts.set(name, 0)

		state.exitCode = null
		this.startTimes.set(name, Date.now())
		runner.restart(cols, rows)
	}

	resize(name: string, cols: number, rows: number): void {
		this.runners.get(name)?.resize(cols, rows)
	}

	resizeAll(cols: number, rows: number): void {
		this.lastCols = cols
		this.lastRows = rows
		for (const runner of this.runners.values()) {
			runner.resize(cols, rows)
		}
	}

	write(name: string, data: string): void {
		this.runners.get(name)?.write(data)
	}

	async stopAll(): Promise<void> {
		log('Stopping all processes')
		this.stopping = true
		// Cancel all pending auto-restart timers
		for (const timer of this.restartTimers.values()) {
			clearTimeout(timer)
		}
		this.restartTimers.clear()
		// Stop in reverse tier order
		const reversed = [...this.tiers].reverse()
		for (const tier of reversed) {
			await Promise.all(tier.map(name => this.runners.get(name)?.stop()).filter(Boolean))
		}
	}
}
