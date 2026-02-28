import { closeSync, mkdirSync, openSync, rmSync, symlinkSync, unlinkSync, writeSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { ProcessEvent } from '../types'
import type { SearchMatch } from '../ui/pane'
import { stripAnsi } from './color'

export interface CrossProcessMatch {
	process: string
	line: number
	start: number
	end: number
}

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

	/** Create a LogWriter in a timestamped subdirectory with a `latest` symlink. */
	static createPersistent(baseDir: string): LogWriter {
		mkdirSync(baseDir, { recursive: true })
		const now = new Date()
		const ts = now
			.toISOString()
			.replace(/:/g, '-')
			.replace(/\.\d+Z$/, '')
		const sessionDir = join(baseDir, ts)
		mkdirSync(sessionDir, { recursive: true })
		const latestLink = join(baseDir, 'latest')
		try {
			unlinkSync(latestLink)
		} catch {
			// Link may not exist yet
		}
		try {
			symlinkSync(sessionDir, latestLink)
		} catch {
			// Symlinks may not be supported
		}
		return new LogWriter(sessionDir, false)
	}

	/** Whether this log directory is temporary (cleaned up on close). */
	get isTemporary(): boolean {
		return this.isTemp
	}

	/** Get the log directory path. */
	getDirectory(): string {
		return this.dir
	}

	/** Get the names of all processes that have written output. */
	getProcessNames(): string[] {
		return [...this.files.keys()]
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
			const cmd =
				process.platform === 'win32' ? ['findstr', '/i', '/n', query, path] : ['grep', '-inF', query, path]
			const proc = Bun.spawn(cmd, {
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

	/** Search all process log files using grep. Returns matches across all processes. */
	async searchAll(query: string): Promise<CrossProcessMatch[]> {
		if (!query) return []
		const paths = [...this.files.keys()].map(name => join(this.dir, `${name}.log`))
		if (paths.length === 0) return []

		try {
			const proc = Bun.spawn(['grep', '-inFH', query, ...paths], {
				stdout: 'pipe',
				stderr: 'ignore'
			})

			const output = await new Response(proc.stdout).text()
			await proc.exited

			const matches: CrossProcessMatch[] = []
			const lowerQuery = query.toLowerCase()

			for (const line of output.split('\n')) {
				if (!line) continue
				// Format: /path/name.log:lineNumber:text
				const firstColon = line.indexOf(':')
				if (firstColon === -1) continue
				const filePath = line.slice(0, firstColon)
				const rest = line.slice(firstColon + 1)

				const secondColon = rest.indexOf(':')
				if (secondColon === -1) continue
				const lineNumber = Number.parseInt(rest.slice(0, secondColon), 10)
				if (Number.isNaN(lineNumber)) continue

				// Extract process name from filename (strip .log extension)
				const fileName = basename(filePath)
				const processName = fileName.replace(/\.log$/, '')

				const lineText = rest.slice(secondColon + 1).toLowerCase()
				let pos = 0
				while (true) {
					const idx = lineText.indexOf(lowerQuery, pos)
					if (idx === -1) break
					matches.push({
						process: processName,
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
