import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

let enabled = false
let logFile = ''
let debugCallback: ((line: string) => void) | null = null

export function enableDebugLog(dir?: string): void {
	const logDir = dir ?? resolve(process.cwd(), '.numux')
	logFile = resolve(logDir, 'debug.log')
	if (!existsSync(logDir)) {
		mkdirSync(logDir, { recursive: true })
	}
	enabled = true
}

export function setDebugCallback(cb: ((line: string) => void) | null): void {
	debugCallback = cb
}
export function log(...args: unknown[]): void {
	if (!enabled) return
	try {
		const timestamp = new Date().toISOString()
		const formatted =
			args.length > 0 ? `${args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}` : ''
		const line = `[${timestamp}] ${formatted}`
		appendFileSync(logFile, `${line}\n`)
		debugCallback?.(line)
	} catch {
		// Disk errors in debug logging should not crash the app
		enabled = false
	}
}

/** Reset logger state (for testing only) */
export function _resetLogger(): void {
	enabled = false
	logFile = ''
	debugCallback = null
}
