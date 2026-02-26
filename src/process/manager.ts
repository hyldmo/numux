import { resolve } from 'node:path'
import { resolveDependencyTiers } from '../config/resolver'
import type { ProcessEvent, ProcessState, ProcessStatus, ResolvedNumuxConfig } from '../types'
import { log } from '../utils/logger'
import { FileWatcher } from '../utils/watcher'
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
	private pendingReadyResolvers = new Map<string, () => void>()
	private readyCaptures = new Map<string, Record<string, string>>()
	private fileWatcher?: FileWatcher

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

		// Create a ready promise per process — each resolves when that process is ready
		const readyPromises = new Map<string, Promise<void>>()
		const readyResolvers = new Map<string, () => void>()

		for (const name of this.tiers.flat()) {
			const { promise, resolve } = Promise.withResolvers<void>()
			readyPromises.set(name, promise)
			readyResolvers.set(name, resolve)
		}

		// Launch all processes concurrently; each waits only for its declared dependencies
		const launches = this.tiers.flat().map(async name => {
			const proc = this.config.processes[name]
			const resolve = readyResolvers.get(name)!

			// Wait for declared dependencies only
			const deps = proc.dependsOn ?? []
			if (deps.length > 0) {
				await Promise.all(deps.map(d => readyPromises.get(d)!))
			}

			if (this.stopping) {
				resolve()
				return
			}

			// Evaluate condition
			if (proc.condition && !evaluateCondition(proc.condition)) {
				log(`Skipping ${name}: condition "${proc.condition}" not met`)
				this.updateStatus(name, 'skipped')
				resolve()
				return
			}

			// Check if any dependency failed or was skipped
			const failedDep = deps.find(d => {
				const s = this.states.get(d)!.status
				return s === 'failed' || s === 'skipped'
			})

			if (failedDep) {
				log(`Skipping ${name}: dependency ${failedDep} failed`)
				this.updateStatus(name, 'skipped')
				resolve()
				return
			}

			this.pendingReadyResolvers.set(name, resolve)
			this.createRunner(name, () => {
				this.pendingReadyResolvers.delete(name)
				resolve()
			})
			this.startProcess(name, cols, rows)

			// Wait for this process to become ready before completing
			await readyPromises.get(name)!
		})

		await Promise.all(launches)
		this.setupWatchers()
	}

	private startProcess(name: string, cols: number, rows: number): void {
		const commandOverride = this.expandDependencyCaptures(name)
		const delay = this.config.processes[name].delay
		if (delay) {
			log(`[${name}] Delaying start by ${delay}ms`)
			const timer = setTimeout(() => {
				this.restartTimers.delete(name)
				if (this.stopping) return
				this.startTimes.set(name, Date.now())
				this.runners.get(name)!.start(cols, rows, commandOverride)
			}, delay)
			this.restartTimers.set(name, timer)
		} else {
			this.startTimes.set(name, Date.now())
			this.runners.get(name)!.start(cols, rows, commandOverride)
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
			onReady: captures => {
				if (captures) {
					this.readyCaptures.set(name, captures)
				}
				if (!readyResolved) {
					readyResolved = true
					onInitialReady!()
				}
			},
			onError: () => this.emit({ type: 'error', name })
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
			if (maxRestarts > 0) {
				const encoder = new TextEncoder()
				const msg = `\r\n\x1b[31m[numux] reached restart limit (${maxRestarts}), giving up\x1b[0m\r\n`
				this.emit({ type: 'output', name, data: encoder.encode(msg) })
			}
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

	private setupWatchers(): void {
		const encoder = new TextEncoder()
		for (const [name, proc] of Object.entries(this.config.processes)) {
			if (!proc.watch) continue
			if (!this.fileWatcher) this.fileWatcher = new FileWatcher()

			const patterns = Array.isArray(proc.watch) ? proc.watch : [proc.watch]
			const cwd = proc.cwd ? resolve(proc.cwd) : process.cwd()

			this.fileWatcher.watch(name, patterns, cwd, changedFile => {
				const state = this.states.get(name)
				if (!state) return
				// Don't restart processes that are stopped/finished, pending, stopping, or skipped
				if (
					state.status === 'pending' ||
					state.status === 'stopped' ||
					state.status === 'finished' ||
					state.status === 'stopping' ||
					state.status === 'skipped'
				)
					return

				log(`[${name}] File changed: ${changedFile}, restarting`)
				const msg = `\r\n\x1b[36m[numux] file changed: ${changedFile}, restarting...\x1b[0m\r\n`
				this.emit({ type: 'output', name, data: encoder.encode(msg) })
				this.restart(name, this.lastCols, this.lastRows)
			})
		}
	}

	/**
	 * Replace $dep.group references in a process command with captured values from dependencies.
	 * Returns the expanded command, or undefined if no expansion was needed.
	 */
	private expandDependencyCaptures(name: string): string | undefined {
		const proc = this.config.processes[name]
		const deps = proc.dependsOn
		if (!deps?.length) return undefined

		// Collect all available captures keyed by process name
		const allCaptures = new Map<string, Record<string, string>>()
		for (const dep of deps) {
			const captures = this.readyCaptures.get(dep)
			if (captures) allCaptures.set(dep, captures)
		}
		if (allCaptures.size === 0) return undefined

		// Build a regex that matches $processName.groupKey for all deps with captures
		const depNames = [...allCaptures.keys()].map(n => escapeRegExp(n)).join('|')
		const refPattern = new RegExp(`\\$(${depNames})\\.(\\w+)`, 'g')

		let hadReplacement = false
		const expanded = proc.command.replace(refPattern, (match, dep: string, key: string) => {
			const captures = allCaptures.get(dep)
			if (captures && key in captures) {
				hadReplacement = true
				return captures[key]
			}
			return match // leave unmatched references as-is
		})

		return hadReplacement ? expanded : undefined
	}

	private updateStatus(name: string, status: ProcessStatus): void {
		const state = this.states.get(name)!
		state.status = status
		// Reset backoff counter when a process with readyPattern signals readiness,
		// meaning it actually stabilized. Processes without readyPattern are immediately
		// ready on spawn, so we rely on the time-based reset in scheduleAutoRestart instead.
		if (status === 'ready' && this.config.processes[name].readyPattern) {
			this.restartAttempts.set(name, 0)
		}
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
		runner.restart(cols, rows, this.expandDependencyCaptures(name))
	}

	/** Stop a single process. No-op if already stopped or not running. */
	async stop(name: string): Promise<void> {
		const state = this.states.get(name)
		if (!state) return
		if (
			state.status === 'pending' ||
			state.status === 'stopped' ||
			state.status === 'finished' ||
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

		const runner = this.runners.get(name)
		if (!runner) return

		// Always try to stop via runner — the process may still be alive even if
		// status is 'failed' (e.g. readyTimeout fired but process didn't exit).
		// runner.stop() is a no-op if proc is null (already exited).
		if (state.status === 'failed') {
			await runner.stop()
			this.updateStatus(name, 'stopped')
			return
		}

		await runner.stop()
	}

	/** Start a single process that is stopped or failed. */
	start(name: string, cols: number, rows: number): void {
		const state = this.states.get(name)
		if (!state) return
		if (state.status !== 'stopped' && state.status !== 'finished' && state.status !== 'failed') return

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
		this.runners.get(name)?.restart(cols, rows, this.expandDependencyCaptures(name))
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
		// Close file watchers
		this.fileWatcher?.close()
		// Cancel all pending auto-restart and delay timers
		for (const timer of this.restartTimers.values()) {
			clearTimeout(timer)
		}
		this.restartTimers.clear()
		// Resolve any pending ready promises (e.g. processes waiting on delay)
		for (const resolve of this.pendingReadyResolvers.values()) {
			resolve()
		}
		this.pendingReadyResolvers.clear()
		// Stop in reverse tier order — use allSettled so one failure doesn't skip remaining tiers
		const reversed = [...this.tiers].reverse()
		for (const tier of reversed) {
			await Promise.allSettled(tier.map(name => this.runners.get(name)?.stop()).filter(Boolean))
		}
	}
}

function escapeRegExp(str: string): string {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const FALSY_VALUES = new Set(['', '0', 'false', 'no', 'off'])

/** Evaluate a condition string against environment variables.
 *  `"VAR"` → truthy if VAR is set and not a falsy value.
 *  `"!VAR"` → truthy if VAR is unset or a falsy value. */
function evaluateCondition(condition: string): boolean {
	const negated = condition.startsWith('!')
	const varName = negated ? condition.slice(1) : condition
	const value = process.env[varName]
	const isTruthy = value !== undefined && !FALSY_VALUES.has(value.toLowerCase())
	return negated ? !isTruthy : isTruthy
}
