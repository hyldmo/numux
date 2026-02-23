import { appendFileSync, existsSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'

const LOG_DIR = resolve(process.cwd(), '.numux')
const LOG_FILE = resolve(LOG_DIR, 'debug.log')

let enabled = false

export function enableDebugLog(): void {
	if (!existsSync(LOG_DIR)) {
		mkdirSync(LOG_DIR, { recursive: true })
	}
	enabled = true
}

export function log(message: string, ...args: unknown[]): void {
	if (!enabled) return
	const timestamp = new Date().toISOString()
	const formatted = args.length > 0 ? `${message} ${args.map(a => JSON.stringify(a)).join(' ')}` : message
	appendFileSync(LOG_FILE, `[${timestamp}] ${formatted}\n`)
}
