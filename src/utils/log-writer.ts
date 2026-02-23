import { closeSync, mkdirSync, openSync, writeSync } from 'node:fs'
import { join } from 'node:path'
import type { ProcessEvent } from '../types'

/** Writes process output to per-process log files in the given directory. */
export class LogWriter {
	private dir: string
	private files = new Map<string, number>()
	private decoder = new TextDecoder()
	private encoder = new TextEncoder()

	constructor(dir: string) {
		this.dir = dir
		mkdirSync(dir, { recursive: true })
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

	close(): void {
		for (const fd of this.files.values()) {
			closeSync(fd)
		}
		this.files.clear()
	}
}

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
const ANSI_RE = /\x1b\[[0-9;]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-Za-z]/g

/** Strip ANSI escape sequences from text */
function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, '')
}
