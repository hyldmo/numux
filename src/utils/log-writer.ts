import { closeSync, mkdirSync, openSync, rmSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProcessEvent } from '../types'
import type { SearchMatch } from '../ui/pane'
import { stripAnsi } from './color'

/** Writes process output to per-process log files in the given directory. */
export class LogWriter {
	private dir: string
	private isTemp: boolean
	private files = new Map<string, number>()
	private decoder = new TextDecoder()
	private encoder = new TextEncoder()

	constructor(dir: string, isTemp = false) {
		this.dir = dir
		this.isTemp = isTemp
		mkdirSync(dir, { recursive: true })
	}

	/** Create a LogWriter in a temporary directory (cleaned up on close). */
	static createTemp(): LogWriter {
		const dir = join(tmpdir(), `numux-${process.pid}`)
		return new LogWriter(dir, true)
	}

	private errored = false

	/** Event listener — pass to ProcessManager.on() */
	handleEvent = (event: ProcessEvent): void => {
		if (event.type !== 'output' || this.errored) return

		try {
			let fd = this.files.get(event.name)
			if (fd === undefined) {
				const path = join(this.dir, `${event.name}.log`)
				fd = openSync(path, 'w')
				this.files.set(event.name, fd)
			}

			const text = this.decoder.decode(event.data, { stream: true })
			const clean = stripAnsi(text)
			writeSync(fd, this.encoder.encode(clean))
		} catch {
			// Disk full, permissions, deleted dir — warn once and stop writing
			this.errored = true
			process.stderr.write(`numux: log writing failed for ${this.dir}, disabling log output\n`)
		}
	}

	/** Get the log file path for a process, or undefined if no output yet. */
	getLogPath(name: string): string | undefined {
		if (this.files.has(name)) {
			return join(this.dir, `${name}.log`)
		}
		return undefined
	}

	/** Search a process's log file using grep. Returns matches with 0-based line numbers. */
	async search(name: string, query: string): Promise<SearchMatch[]> {
		if (!query) return []
		const path = this.getLogPath(name)
		if (!path) return []

		try {
			const proc = Bun.spawn(['grep', '-inF', query, path], {
				stdout: 'pipe',
				stderr: 'ignore'
			})

			const output = await new Response(proc.stdout).text()
			await proc.exited

			const matches: SearchMatch[] = []
			const lowerQuery = query.toLowerCase()

			for (const line of output.split('\n')) {
				if (!line) continue
				const colonIdx = line.indexOf(':')
				if (colonIdx === -1) continue

				const lineNumber = Number.parseInt(line.slice(0, colonIdx), 10)
				if (Number.isNaN(lineNumber)) continue

				const lineText = line.slice(colonIdx + 1).toLowerCase()
				let pos = 0
				while (true) {
					const idx = lineText.indexOf(lowerQuery, pos)
					if (idx === -1) break
					matches.push({
						line: lineNumber - 1, // grep is 1-based, terminal is 0-based
						start: idx,
						end: idx + query.length
					})
					pos = idx + 1
				}
			}

			return matches
		} catch {
			return []
		}
	}

	/** Truncate a process's log file (used when pane is cleared). */
	truncate(name: string): void {
		const fd = this.files.get(name)
		if (fd === undefined) return
		try {
			closeSync(fd)
			const path = join(this.dir, `${name}.log`)
			const newFd = openSync(path, 'w')
			this.files.set(name, newFd)
		} catch {
			// Ignore errors — file may have been deleted
		}
	}

	close(): void {
		for (const fd of this.files.values()) {
			closeSync(fd)
		}
		this.files.clear()
	}

	/** Close files and remove the directory if it was auto-created. */
	cleanup(): void {
		this.close()
		if (this.isTemp) {
			try {
				rmSync(this.dir, { recursive: true })
			} catch {
				// Ignore cleanup errors
			}
		}
	}
}
