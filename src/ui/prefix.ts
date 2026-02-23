import type { ProcessManager } from '../process/manager'
import type { ProcessEvent, ProcessStatus, ResolvedNumuxConfig } from '../types'
import { hexToAnsi } from '../utils/color'
import type { LogWriter } from '../utils/log-writer'

/** Default ANSI colors for process name prefixes */
const PREFIX_COLORS = ['\x1b[36m', '\x1b[33m', '\x1b[35m', '\x1b[34m', '\x1b[32m', '\x1b[91m', '\x1b[93m', '\x1b[95m']
const RESET = '\x1b[0m'
const DIM = '\x1b[90m'

const STATUS_ANSI: Partial<Record<ProcessStatus, string>> = {
	ready: '\x1b[32m',
	failed: '\x1b[31m',
	stopped: '\x1b[90m',
	skipped: '\x1b[90m'
}

/**
 * Concurrently-style prefixed output mode for CI and headless environments.
 * Prints all process output interleaved with colored [name] prefixes.
 */
export class PrefixDisplay {
	private manager: ProcessManager
	private colors: Map<string, string>
	private noColor: boolean
	private decoders = new Map<string, TextDecoder>()
	private buffers = new Map<string, string>()
	private maxNameLen: number
	private logWriter?: LogWriter
	private stopping = false

	constructor(manager: ProcessManager, config: ResolvedNumuxConfig, logWriter?: LogWriter) {
		this.manager = manager
		this.logWriter = logWriter
		this.noColor = 'NO_COLOR' in process.env
		const names = manager.getProcessNames()
		this.maxNameLen = Math.max(...names.map(n => n.length))
		this.colors = this.buildColorMap(names, config)
		for (const name of names) {
			this.decoders.set(name, new TextDecoder('utf-8', { fatal: false }))
			this.buffers.set(name, '')
		}
	}

	private buildColorMap(names: string[], config: ResolvedNumuxConfig): Map<string, string> {
		const map = new Map<string, string>()
		if ('NO_COLOR' in process.env) return map
		let paletteIndex = 0
		for (const name of names) {
			const explicit = config.processes[name]?.color
			if (explicit) {
				map.set(name, hexToAnsi(explicit))
			} else {
				map.set(name, PREFIX_COLORS[paletteIndex % PREFIX_COLORS.length])
				paletteIndex++
			}
		}
		return map
	}

	async start(): Promise<void> {
		const handler = (event: ProcessEvent) => {
			this.logWriter?.handleEvent(event)
			this.handleEvent(event)
		}
		this.manager.on(handler)

		process.on('SIGINT', () => this.shutdown())
		process.on('SIGTERM', () => this.shutdown())

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
			this.checkAllDone()
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

	private printLine(name: string, line: string): void {
		const padded = name.padEnd(this.maxNameLen)
		if (this.noColor) {
			process.stdout.write(`[${padded}] ${line}\n`)
		} else {
			const color = this.colors.get(name) ?? ''
			process.stdout.write(`${color}[${padded}]${RESET} ${line}\n`)
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
			const anyFailed = states.some(s => s.status === 'failed')
			process.exit(anyFailed ? 1 : 0)
		}
	}

	async shutdown(): Promise<void> {
		if (this.stopping) return
		this.stopping = true
		await this.manager.stopAll()
		this.logWriter?.close()
		process.exit(0)
	}
}
