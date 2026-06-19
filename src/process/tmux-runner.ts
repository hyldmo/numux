import { mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import type { ResolvedProcessConfig } from '../types'
import { loadEnvFiles } from '../utils/env-file'
import { log } from '../utils/logger'
import { createErrorChecker } from './error'
import { createReadinessChecker } from './ready'
import type { Runner, RunnerEventHandler } from './runner'

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

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`
}

interface Closeable {
	close: () => void
}

export class TmuxRunner implements Runner {
	readonly name: string
	private config: ResolvedProcessConfig
	private handler: RunnerEventHandler
	private windowTarget: string
	private readiness: ReturnType<typeof createReadinessChecker>
	private errorChecker: ReturnType<typeof createErrorChecker>
	private _ready = false
	private stopping = false
	private generation = 0
	private readyTimer: ReturnType<typeof setTimeout> | null = null
	private readyTimedOut = false
	private restarting = false
	private commandOverride: string | undefined
	private envOverride: Record<string, string> | undefined
	private pipeWatcher: Closeable | null = null
	private exitWatcher: Closeable | null = null
	private tmpDir: string
	private windowCreated = false

	constructor(
		name: string,
		config: ResolvedProcessConfig,
		handler: RunnerEventHandler,
		sessionName: string,
		windowIndex: number
	) {
		this.name = name
		this.config = config
		this.handler = handler
		this.windowTarget = `${sessionName}:${windowIndex}`
		this.readiness = createReadinessChecker(config)
		this.errorChecker = createErrorChecker(config)
		this.tmpDir = resolve(tmpdir(), `numux-${process.pid}`)
		mkdirSync(this.tmpDir, { recursive: true })
	}

	get isReady(): boolean {
		return this._ready
	}

	private get signal(): NodeJS.Signals {
		return this.config.stopSignal ?? 'SIGTERM'
	}

	start(_cols: number, _rows: number, commandOverride?: string, envOverride?: Record<string, string>): void {
		if (commandOverride !== undefined) this.commandOverride = commandOverride
		if (envOverride !== undefined) this.envOverride = envOverride
		const command = this.commandOverride ?? this.config.command
		const gen = ++this.generation
		this.stopping = false
		log(`[${this.name}] TmuxRunner starting (gen ${gen}): ${command}`)
		this.handler.onStatus('starting')

		this.doStart(command, gen).catch(err => {
			log(`[${this.name}] TmuxRunner start failed: ${err}`)
			const encoder = new TextEncoder()
			const msg = `\r\n\x1b[31m[numux] failed to start: ${err instanceof Error ? err.message : err}\x1b[0m\r\n`
			this.handler.onOutput(encoder.encode(msg))
			this.handler.onStatus('failed')
			this.handler.onExit(null)
		})
	}

	private async doStart(command: string, gen: number): Promise<void> {
		const cwd = this.config.cwd ? resolve(this.config.cwd) : process.cwd()
		const envFromFile = this.config.envFile ? loadEnvFiles(this.config.envFile, cwd) : {}
		const noColor = 'NO_COLOR' in process.env
		const env: Record<string, string> = {
			...(process.env as Record<string, string>),
			...(noColor ? {} : { FORCE_COLOR: '1' }),
			TERM: 'xterm-256color',
			...envFromFile,
			...(this.envOverride ?? this.config.env)
		}

		// Build env export preamble for tmux — only export vars that differ from current env
		const envPairs = Object.entries(env)
			.filter(([k]) => !(k in process.env) || env[k] !== process.env[k])
			.map(([k, v]) => `export ${k}=${shellEscape(v)}`)
			.join('; ')

		const pipePath = resolve(this.tmpDir, `${this.name}.pipe`)
		const exitPath = resolve(this.tmpDir, `${this.name}.exit`)

		// Reset monitoring files
		try {
			await Bun.write(pipePath, '')
			await Bun.write(exitPath, '')
		} catch {
			// Ignore — files may not exist yet
		}

		// Wrap command with exit sentinel
		const stdinRedirect = this.config.interactive ? '' : ' 0</dev/null'
		const cwdPart = `cd ${shellEscape(cwd)}`
		const envPart = envPairs ? `${envPairs}; ` : ''
		const showCmd =
			this.config.showCommand !== false
				? `printf '\\033[2m$ ${command.replace(/'/g, "'\\''")}\\033[0m\\n\\n'; `
				: ''
		const wrappedCommand = `${cwdPart} && ${envPart}${showCmd}${command}${stdinRedirect}; echo "$?" > ${shellEscape(exitPath)}`

		if (!this.windowCreated) {
			await tmux('send-keys', '-t', this.windowTarget, wrappedCommand, 'Enter')
			this.windowCreated = true
		} else {
			await tmux('respawn-pane', '-k', '-t', this.windowTarget, wrappedCommand)
		}

		// Set up pipe-pane for output monitoring
		await tmux('pipe-pane', '-o', '-t', this.windowTarget, `cat >> ${shellEscape(pipePath)}`)

		if (this.generation !== gen) return

		this.handler.onStatus('running')

		this.startReadyTimeout(gen)
		this.monitorOutput(pipePath, gen)
		this.monitorExit(exitPath, gen)
	}

	private monitorOutput(pipePath: string, gen: number): void {
		let lastSize = 0
		const decoder = new TextDecoder()
		const errorDecoder = new TextDecoder()

		const checkOutput = async () => {
			if (this.generation !== gen) return
			try {
				const file = Bun.file(pipePath)
				const size = file.size
				if (size > lastSize) {
					const blob = file.slice(lastSize, size)
					const bytes = new Uint8Array(await blob.arrayBuffer())
					lastSize = size

					this.handler.onOutput(bytes)

					if (!this._ready) {
						const text = decoder.decode(bytes, { stream: true })
						if (this.readiness.feedOutput(text)) {
							this.markReady()
						}
					}

					if (this.errorChecker) {
						const text = errorDecoder.decode(bytes, { stream: true })
						if (this.errorChecker.feedOutput(text)) {
							this.handler.onError()
						}
					}
				}
			} catch {
				// File may not exist yet or be in use
			}
		}

		const interval = setInterval(() => {
			if (this.generation !== gen) {
				clearInterval(interval)
				return
			}
			checkOutput()
		}, 50)

		this.pipeWatcher = { close: () => clearInterval(interval) }
	}

	private monitorExit(exitPath: string, gen: number): void {
		const checkExit = async () => {
			if (this.generation !== gen) return
			try {
				const content = await Bun.file(exitPath).text()
				const trimmed = content.trim()
				if (trimmed.length > 0) {
					const code = Number.parseInt(trimmed, 10)
					if (this.generation !== gen) return

					log(`[${this.name}] Exited with code ${code}`)

					if (this.readiness.dependsOnExit && code === 0) {
						this.markReady()
					}

					if (code === 127 || code === 126) {
						const encoder = new TextEncoder()
						const hint = code === 127 ? 'command not found' : 'permission denied'
						const msg = `\r\n\x1b[31m[numux] exit ${code}: ${hint}\x1b[0m\r\n`
						this.handler.onOutput(encoder.encode(msg))
					}

					if (!(this.readyTimedOut || this.restarting)) {
						const status = this.stopping ? 'stopped' : code === 0 ? 'finished' : 'failed'
						this.handler.onStatus(status)
						this.handler.onExit(code)
					}

					if (this.exitWatcher) {
						this.exitWatcher.close()
						this.exitWatcher = null
					}
				}
			} catch {
				// File may not exist yet
			}
		}

		const interval = setInterval(() => {
			if (this.generation !== gen) {
				clearInterval(interval)
				return
			}
			checkExit()
		}, 100)

		this.exitWatcher = { close: () => clearInterval(interval) }
	}

	private startReadyTimeout(gen: number): void {
		const timeout = this.config.readyTimeout
		if (!(timeout && this.config.readyPattern)) return

		this.readyTimer = setTimeout(() => {
			this.readyTimer = null
			if (this.generation !== gen || this._ready) return
			this.readyTimedOut = true
			log(`[${this.name}] Ready timeout after ${timeout}ms`)
			const encoder = new TextEncoder()
			const msg = `\r\n\x1b[31m[numux] readyPattern not matched within ${(timeout / 1000).toFixed(0)}s — marking as failed\x1b[0m\r\n`
			this.handler.onOutput(encoder.encode(msg))
			this.handler.onStatus('failed')
			this.handler.onReady()
		}, timeout)
	}

	private clearReadyTimeout(): void {
		if (this.readyTimer) {
			clearTimeout(this.readyTimer)
			this.readyTimer = null
		}
	}

	private markReady(): void {
		if (this._ready) return
		this._ready = true
		this.clearReadyTimeout()
		log(`[${this.name}] Ready`)
		this.handler.onStatus('ready')
		this.handler.onReady(this.readiness.captures)
	}

	async restart(
		cols: number,
		rows: number,
		commandOverride?: string,
		envOverride?: Record<string, string>
	): Promise<void> {
		if (this.restarting) return
		this.restarting = true
		log(`[${this.name}] Restarting`)
		this.clearReadyTimeout()
		this.cleanup()

		try {
			const pid = await tmux('display-message', '-t', this.windowTarget, '-p', '#{pane_pid}')
			if (pid) {
				try {
					process.kill(Number(pid), this.signal)
					await new Promise<void>(r => setTimeout(r, 2000))
				} catch {
					// Process may have already exited
				}
			}
		} catch {
			// Pane may not exist
		}

		this._ready = false
		this.restarting = false
		this.readyTimedOut = false
		this.readiness = createReadinessChecker(this.config)
		this.errorChecker = createErrorChecker(this.config)
		this.start(cols, rows, commandOverride, envOverride)
	}

	async stop(timeoutMs = 5000): Promise<void> {
		this.clearReadyTimeout()
		this.stopping = true
		log(`[${this.name}] Stopping (timeout: ${timeoutMs}ms)`)
		this.handler.onStatus('stopping')

		try {
			const pid = await tmux('display-message', '-t', this.windowTarget, '-p', '#{pane_pid}')
			if (pid) {
				try {
					process.kill(Number(pid), this.signal)
				} catch {
					// Process may have already exited
				}
				await new Promise<void>(r => setTimeout(r, timeoutMs))
				try {
					process.kill(Number(pid), 'SIGKILL')
				} catch {
					// Process already dead
				}
			}
		} catch {
			// Pane may not exist
		}

		this.cleanup()
	}

	resize(_cols: number, _rows: number): void {
		// tmux handles resize automatically
	}

	write(data: string): void {
		if (!this.config.interactive) return
		// Fire-and-forget: best effort to send keys
		tmux('send-keys', '-t', this.windowTarget, '-l', data).catch(_err => {
			// Ignore — pane may be dead
		})
	}

	private cleanup(): void {
		if (this.pipeWatcher) {
			this.pipeWatcher.close()
			this.pipeWatcher = null
		}
		if (this.exitWatcher) {
			this.exitWatcher.close()
			this.exitWatcher = null
		}
		// Stop pipe-pane (fire-and-forget)
		tmux('pipe-pane', '-t', this.windowTarget).catch(_err => {
			// Ignore — session may be dead
		})
	}
}
