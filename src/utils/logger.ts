import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

let enabled = false
let logFile = ''

export function enableDebugLog(dir?: string): void {
	const logDir = dir ?? resolve(process.cwd(), '.numux')
	logFile = resolve(logDir, 'debug.log')
	if (!existsSync(logDir)) {
		mkdirSync(logDir, { recursive: true })
	}
	enabled = true
}

export function log(message: string, ...args: unknown[]): void {
	if (!enabled) return
	const timestamp = new Date().toISOString()
	const formatted = args.length > 0 ? `${message} ${args.map(a => JSON.stringify(a)).join(' ')}` : message
	appendFileSync(logFile, `[${timestamp}] ${formatted}\n`)
}

/** Reset logger state (for testing only) */
export function _resetLogger(): void {
	enabled = false
	logFile = ''
}
