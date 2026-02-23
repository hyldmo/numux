import { resolveDependencyTiers } from '../config/resolver'
import type { NumuxConfig, ProcessEvent, ProcessState, ProcessStatus } from '../types'
import { ProcessRunner } from './runner'

type EventListener = (event: ProcessEvent) => void

export class ProcessManager {
	private config: NumuxConfig
	private runners = new Map<string, ProcessRunner>()
	private states = new Map<string, ProcessState>()
	private tiers: string[][]
	private listeners: EventListener[] = []

	constructor(config: NumuxConfig) {
		this.config = config
		this.tiers = resolveDependencyTiers(config)

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
					this.updateStatus(name, 'skipped')
					continue
				}

				const { promise, resolve } = Promise.withResolvers<void>()
				readyPromises.push(promise)

				const runner = new ProcessRunner(name, this.config.processes[name], {
					onStatus: status => this.updateStatus(name, status),
					onOutput: data => this.emit({ type: 'output', name, data }),
					onExit: code => {
						const state = this.states.get(name)!
						state.exitCode = code
						this.emit({ type: 'exit', name, code })
						// Unblock tier if process exits before becoming ready
						resolve()
					},
					onReady: () => resolve()
				})

				this.runners.set(name, runner)
				runner.start(cols, rows)
			}

			// Wait for all processes in this tier to become ready
			if (readyPromises.length > 0) {
				await Promise.all(readyPromises)
			}
		}
	}

	private updateStatus(name: string, status: ProcessStatus): void {
		const state = this.states.get(name)!
		state.status = status
		this.emit({ type: 'status', name, status })
	}

	resize(name: string, cols: number, rows: number): void {
		this.runners.get(name)?.resize(cols, rows)
	}

	resizeAll(cols: number, rows: number): void {
		for (const runner of this.runners.values()) {
			runner.resize(cols, rows)
		}
	}

	write(name: string, data: string): void {
		this.runners.get(name)?.write(data)
	}

	async stopAll(): Promise<void> {
		// Stop in reverse tier order
		const reversed = [...this.tiers].reverse()
		for (const tier of reversed) {
			await Promise.all(tier.map(name => this.runners.get(name)?.stop()).filter(Boolean))
		}
	}
}
