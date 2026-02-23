import { resolveDependencyTiers } from '../config/resolver'
import type { ProcessEvent, ProcessState, ProcessStatus, ResolvedNumuxConfig } from '../types'
import { log } from '../utils/logger'
import { ProcessRunner } from './runner'

type EventListener = (event: ProcessEvent) => void

const BACKOFF_BASE_MS = 1000
const BACKOFF_MAX_MS = 30_000
const BACKOFF_RESET_MS = 10_000

export class ProcessManager {
	private config: ResolvedNumuxConfig
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

	constructor(config: ResolvedNumuxConfig) {
		this.config = config
		this.tiers = resolveDependencyTiers(config)
		log(`Resolved ${this.tiers.length} dependency tiers:`, this.tiers)

		for (const [name, proc] of Object.entries(config.processes)) {
			this.states.set(name, {
				name,
				config: proc,
				status: 'pending',
				exitCode: null,
				restartCount: 0
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
				this.startTimes.set(name, Date.now())
				this.runners.get(name)!.start(cols, rows)
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
		// null exitCode means spawn failed — retrying won't help
		if (exitCode === null) return
		log(`Scheduling auto-restart for ${name} (exit code: ${exitCode})`)

		// Reset backoff if the process ran long enough
		const startTime = this.startTimes.get(name) ?? 0
		if (Date.now() - startTime > BACKOFF_RESET_MS) {
			this.restartAttempts.set(name, 0)
		}

		const attempt = this.restartAttempts.get(name) ?? 0

		// Enforce maxRestarts limit
		const maxRestarts = proc.maxRestarts
		if (maxRestarts !== undefined && attempt >= maxRestarts) {
			log(`[${name}] Reached maxRestarts limit (${maxRestarts}), not restarting`)
			const encoder = new TextEncoder()
			const msg = `\r\n\x1b[31m[numux] reached restart limit (${maxRestarts}), giving up\x1b[0m\r\n`
			this.emit({ type: 'output', name, data: encoder.encode(msg) })
			return
		}

		const delay = Math.min(BACKOFF_BASE_MS * 2 ** attempt, BACKOFF_MAX_MS)
		this.restartAttempts.set(name, attempt + 1)

		const encoder = new TextEncoder()
		const msg = `\r\n\x1b[33m[numux] restarting in ${(delay / 1000).toFixed(0)}s (attempt ${attempt + 1}${maxRestarts !== undefined ? `/${maxRestarts}` : ''})...\x1b[0m\r\n`
		this.emit({ type: 'output', name, data: encoder.encode(msg) })

		const timer = setTimeout(() => {
			this.restartTimers.delete(name)
			if (this.stopping) return
			const runner = this.runners.get(name)
			if (!runner) return
			const state = this.states.get(name)
			if (state) state.restartCount++
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
		if (state.status === 'pending' || state.status === 'stopping' || state.status === 'skipped') return

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
		state.restartCount++
		this.startTimes.set(name, Date.now())
		runner.restart(cols, rows)
	}

	/** Stop a single process. No-op if already stopped or not running. */
	async stop(name: string): Promise<void> {
		const state = this.states.get(name)
		if (!state) return
		if (
			state.status === 'pending' ||
			state.status === 'stopped' ||
			state.status === 'stopping' ||
			state.status === 'skipped'
		)
			return

		// Cancel pending auto-restart
		const timer = this.restartTimers.get(name)
		if (timer) {
			clearTimeout(timer)
			this.restartTimers.delete(name)
		}

		// If the process already exited (failed), just mark as stopped
		if (state.status === 'failed') {
			this.updateStatus(name, 'stopped')
			return
		}

		const runner = this.runners.get(name)
		if (!runner) return
		await runner.stop()
	}

	/** Start a single process that is stopped or failed. */
	start(name: string, cols: number, rows: number): void {
		const state = this.states.get(name)
		if (!state) return
		if (state.status !== 'stopped' && state.status !== 'failed') return

		// Cancel pending auto-restart and reset backoff
		const timer = this.restartTimers.get(name)
		if (timer) {
			clearTimeout(timer)
			this.restartTimers.delete(name)
		}
		this.restartAttempts.set(name, 0)

		state.exitCode = null
		state.restartCount++
		this.startTimes.set(name, Date.now())
		this.runners.get(name)?.restart(cols, rows)
	}

	/** Restart all processes. Restarts each runner in-place without dependency re-resolution. */
	restartAll(cols: number, rows: number): void {
		log('Restarting all processes')
		for (const name of this.tiers.flat()) {
			this.restart(name, cols, rows)
		}
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
		// Stop in reverse tier order — use allSettled so one failure doesn't skip remaining tiers
		const reversed = [...this.tiers].reverse()
		for (const tier of reversed) {
			await Promise.allSettled(tier.map(name => this.runners.get(name)?.stop()).filter(Boolean))
		}
	}
}
