import type { ProcessManager } from '../process/manager'
import type { RunnerFactory } from '../process/runner'
import { TmuxRunner } from '../process/tmux-runner'
import type { ProcessEvent, ProcessStatus, ResolvedNumuxConfig } from '../types'
import type { LogWriter } from '../utils/log-writer'

const STATUS_ICONS: Record<ProcessStatus, string> = {
	pending: '○',
	starting: '◐',
	running: '◉',
	ready: '●',
	stopping: '◑',
	stopped: '■',
	finished: '✓',
	failed: '✖',
	skipped: '⊘'
}

async function tmux(...args: string[]): Promise<string> {
	const proc = Bun.spawn(['tmux', ...args], {
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const exitCode = await proc.exited
	const stdout = await new Response(proc.stdout).text()
	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text()
		throw new Error(`tmux ${args[0]} failed (${exitCode}): ${stderr.trim()}`)
	}
	return stdout.trim()
}

export interface TmuxDisplayOptions {
	logWriter?: LogWriter
	killOthers?: boolean
	killOthersOnFail?: boolean
}

export class TmuxDisplay {
	private manager!: ProcessManager
	private logWriter?: LogWriter
	private killOthers: boolean
	private killOthersOnFail: boolean
	private stopping = false
	private sessionName: string
	private windowIndices = new Map<string, number>()

	constructor(_config: ResolvedNumuxConfig, options: TmuxDisplayOptions = {}) {
		this.logWriter = options.logWriter
		this.killOthers = options.killOthers ?? false
		this.killOthersOnFail = options.killOthersOnFail ?? false
		this.sessionName = `numux-${process.pid}`
	}

	setManager(manager: ProcessManager): void {
		this.manager = manager
	}

	/** Create a RunnerFactory that produces TmuxRunners bound to this session */
	createRunnerFactory(): RunnerFactory {
		let windowIndex = 0
		return (name, config, handler) => {
			const idx = windowIndex++
			this.windowIndices.set(name, idx)
			return new TmuxRunner(name, config, handler, this.sessionName, idx)
		}
	}

	async start(): Promise<void> {
		// Check tmux is available
		try {
			await tmux('-V')
		} catch (err) {
			throw new Error('tmux is not installed or not in PATH', { cause: err })
		}

		const cols = process.stdout.columns || 80
		const rows = process.stdout.rows || 24

		// Create tmux session with first window
		const names = this.manager.getProcessNames()
		await tmux(
			'new-session',
			'-d',
			'-s',
			this.sessionName,
			'-x',
			String(cols),
			'-y',
			String(rows),
			'-n',
			`${STATUS_ICONS.pending} ${names[0]}`
		)

		// Configure session
		await tmux('set-option', '-t', this.sessionName, 'remain-on-exit', 'on')
		await tmux('set-option', '-t', this.sessionName, 'status-left', ` numux `)
		await tmux('set-option', '-t', this.sessionName, 'status-right', ' R:restart  ctrl-c:quit ')

		// Create additional windows
		for (let i = 1; i < names.length; i++) {
			await tmux('new-window', '-t', this.sessionName, '-n', `${STATUS_ICONS.pending} ${names[i]}`)
		}

		// Select first window
		await tmux('select-window', '-t', `${this.sessionName}:0`)

		// Subscribe to process events
		this.manager.on((event: ProcessEvent) => {
			this.logWriter?.handleEvent(event)
			this.handleEvent(event)
		})

		// Start all processes
		await this.manager.startAll(cols, rows)

		// Attach to the session (blocks until detach or session killed)
		const attach = Bun.spawn(['tmux', 'attach-session', '-t', this.sessionName], {
			stdin: 'inherit',
			stdout: 'inherit',
			stderr: 'inherit'
		})

		await attach.exited

		// If the session was killed externally, shut down
		if (!this.stopping) {
			await this.shutdown()
		}
	}

	private handleEvent(event: ProcessEvent): void {
		if (event.type === 'status') {
			this.updateWindowName(event.name, event.status)
			if (event.status === 'failed') {
				this.setWindowErrorStyle(event.name)
			}
		} else if (event.type === 'error') {
			this.setWindowErrorStyle(event.name)
		} else if (event.type === 'exit') {
			const exitCode = this.manager.getState(event.name)?.exitCode ?? null
			if (this.killOthers || (this.killOthersOnFail && exitCode !== 0)) {
				this.shutdown()
			} else {
				this.checkAllDone()
			}
		}
	}

	private updateWindowName(name: string, status: ProcessStatus): void {
		const windowIdx = this.windowIndices.get(name)
		if (windowIdx === undefined) return
		const icon = STATUS_ICONS[status]
		const windowName = `${icon} ${name}`
		tmux('rename-window', '-t', `${this.sessionName}:${windowIdx}`, windowName).catch(_err => {
			// Ignore — session may be dead
		})
	}

	private setWindowErrorStyle(name: string): void {
		const windowIdx = this.windowIndices.get(name)
		if (windowIdx === undefined) return
		tmux('set-window-option', '-t', `${this.sessionName}:${windowIdx}`, 'window-status-style', 'fg=red').catch(
			_err => {
				// Ignore — session may be dead
			}
		)
	}

	private checkAllDone(): void {
		if (this.stopping) return
		const states = this.manager.getAllStates()
		const allDone = states.every(
			s => s.status === 'stopped' || s.status === 'finished' || s.status === 'failed' || s.status === 'skipped'
		)
		if (allDone) {
			this.shutdown()
		}
	}

	hasFailures(): boolean {
		return this.manager.getAllStates().some(s => s.status === 'failed')
	}

	async shutdown(): Promise<void> {
		if (this.stopping) return
		this.stopping = true

		await this.manager.stopAll()

		// Kill the tmux session
		try {
			await tmux('kill-session', '-t', this.sessionName)
		} catch {
			// Session may already be dead
		}

		this.logWriter?.cleanup()
		const anyFailed = this.hasFailures()
		process.exit(anyFailed ? 1 : 0)
	}
}
