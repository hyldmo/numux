import type { ProcessManager } from '../process/manager'
import type { ProcessEvent, ProcessStatus, ResolvedNumuxConfig } from '../types'
import { ANSI_RESET, buildProcessColorMap, STATUS_ANSI, stripAnsi } from '../utils/color'
import type { LogWriter } from '../utils/log-writer'

const RESET = ANSI_RESET
const DIM = '\x1b[90m'

/**
 * Concurrently-style prefixed output mode for CI and headless environments.
 * Prints all process output interleaved with colored [name] prefixes.
 */
export interface PrefixDisplayOptions {
	logWriter?: LogWriter
	killOthers?: boolean
	timestamps?: boolean
}

export class PrefixDisplay {
	private manager: ProcessManager
	private colors: Map<string, string>
	private noColor: boolean
	private decoders = new Map<string, TextDecoder>()
	private buffers = new Map<string, string>()
	private maxNameLen: number
	private logWriter?: LogWriter
	private killOthers: boolean
	private timestamps: boolean
	private stopping = false

	constructor(manager: ProcessManager, config: ResolvedNumuxConfig, options: PrefixDisplayOptions = {}) {
		this.manager = manager
		this.logWriter = options.logWriter
		this.killOthers = options.killOthers ?? false
		this.timestamps = options.timestamps ?? false
		this.noColor = 'NO_COLOR' in process.env
		const names = manager.getProcessNames()
		this.maxNameLen = Math.max(...names.map(n => n.length))
		this.colors = buildProcessColorMap(names, config)
		for (const name of names) {
			this.decoders.set(name, new TextDecoder('utf-8', { fatal: false }))
			this.buffers.set(name, '')
		}
	}

	async start(): Promise<void> {
		const handler = (event: ProcessEvent) => {
			this.logWriter?.handleEvent(event)
			this.handleEvent(event)
		}
		this.manager.on(handler)

		process.on('SIGINT', () => this.shutdown())
		process.on('SIGTERM', () => this.shutdown())
		process.on('uncaughtException', err => {
			process.stderr.write(`numux: unexpected error: ${err?.stack ?? err}\n`)
			this.shutdown()
		})
		process.on('unhandledRejection', (reason: unknown) => {
			const message = reason instanceof Error ? reason.message : String(reason)
			process.stderr.write(`numux: unhandled rejection: ${message}\n`)
			this.shutdown()
		})

		const cols = process.stdout.columns || 80
		const rows = process.stdout.rows || 24
		await this.manager.startAll(cols, rows)

		// After all processes started, check if any are non-persistent
		// If all non-persistent processes have exited, we're done
		this.checkAllDone()
	}

	private handleEvent(event: ProcessEvent): void {
		if (event.type === 'output') {
			this.handleOutput(event.name, event.data)
		} else if (event.type === 'status') {
			this.handleStatus(event.name, event.status)
		} else if (event.type === 'exit') {
			// Flush remaining buffer
			this.flushBuffer(event.name)
			if (this.killOthers) {
				this.killAllAndExit(event.name)
			} else {
				this.checkAllDone()
			}
		}
	}

	private handleOutput(name: string, data: Uint8Array): void {
		const decoder = this.decoders.get(name) ?? new TextDecoder()
		const text = decoder.decode(data, { stream: true })
		const buffer = (this.buffers.get(name) ?? '') + text
		const lines = buffer.split(/\r?\n/)

		// Keep the last element (incomplete line) in the buffer
		this.buffers.set(name, lines.pop() ?? '')

		for (const line of lines) {
			this.printLine(name, line)
		}
	}

	private handleStatus(name: string, status: ProcessStatus): void {
		if (status === 'ready' || status === 'failed' || status === 'stopped' || status === 'skipped') {
			if (this.noColor) {
				this.printLine(name, `→ ${status}`)
			} else {
				const ansi = STATUS_ANSI[status]
				const statusText = ansi ? `${ansi}${status}${RESET}` : status
				this.printLine(name, `${DIM}→ ${statusText}${DIM}${RESET}`)
			}
		}
	}

	private formatTimestamp(): string {
		const now = new Date()
		const h = String(now.getHours()).padStart(2, '0')
		const m = String(now.getMinutes()).padStart(2, '0')
		const s = String(now.getSeconds()).padStart(2, '0')
		return `${h}:${m}:${s}`
	}

	private printLine(name: string, line: string): void {
		const padded = name.padEnd(this.maxNameLen)
		const ts = this.timestamps ? `${DIM}[${this.formatTimestamp()}]${RESET} ` : ''
		const tsPlain = this.timestamps ? `[${this.formatTimestamp()}] ` : ''
		if (this.noColor) {
			process.stdout.write(`${tsPlain}[${padded}] ${stripAnsi(line)}\n`)
		} else {
			const color = this.colors.get(name) ?? ''
			process.stdout.write(`${ts}${color}[${padded}]${RESET} ${line}\n`)
		}
	}

	private flushBuffer(name: string): void {
		const remaining = this.buffers.get(name) ?? ''
		if (remaining.length > 0) {
			this.printLine(name, remaining)
			this.buffers.set(name, '')
		}
	}

	private checkAllDone(): void {
		if (this.stopping) return
		const states = this.manager.getAllStates()
		const allDone = states.every(s => s.status === 'stopped' || s.status === 'failed' || s.status === 'skipped')
		if (allDone) {
			this.printSummary()
			this.logWriter?.close()
			const anyFailed = states.some(s => s.status === 'failed')
			process.exit(anyFailed ? 1 : 0)
		}
	}

	private killAllAndExit(exitedName: string): void {
		if (this.stopping) return
		this.stopping = true
		const state = this.manager.getState(exitedName)
		const code = state?.exitCode ?? 1
		this.manager.stopAll().then(() => {
			for (const name of this.manager.getProcessNames()) {
				this.flushBuffer(name)
			}
			this.printSummary()
			this.logWriter?.close()
			process.exit(code === 0 ? 0 : 1)
		})
	}

	private printSummary(): void {
		const states = this.manager.getAllStates()
		const namePad = Math.max(...states.map(s => s.name.length))
		process.stdout.write('\n')
		for (const s of states) {
			const name = s.name.padEnd(namePad)
			const exitStr = s.exitCode !== null ? `exit ${s.exitCode}` : ''
			if (this.noColor) {
				process.stdout.write(`  ${name}  ${s.status}${exitStr ? `  (${exitStr})` : ''}\n`)
			} else {
				const ansi = STATUS_ANSI[s.status] ?? ''
				const statusText = ansi ? `${ansi}${s.status}${RESET}` : s.status
				process.stdout.write(`  ${name}  ${statusText}${exitStr ? `  ${DIM}(${exitStr})${RESET}` : ''}\n`)
			}
		}
	}

	async shutdown(): Promise<void> {
		if (this.stopping) return
		this.stopping = true
		await this.manager.stopAll()
		for (const name of this.manager.getProcessNames()) {
			this.flushBuffer(name)
		}
		this.logWriter?.close()
		const anyFailed = this.manager.getAllStates().some(s => s.status === 'failed')
		process.exit(anyFailed ? 1 : 0)
	}
}
