import type { ResolvedProcessConfig } from '../types'
import { stripAnsi } from '../utils/color'

/** Keep the last 64 KB of output for pattern matching */
const BUFFER_CAP = 65_536

/** Extract named and positional capture groups from a regex match */
function extractCaptures(match: RegExpExecArray): Record<string, string> | null {
	const result: Record<string, string> = {}
	let hasCaptures = false

	if (match.groups) {
		for (const [key, value] of Object.entries(match.groups)) {
			if (value !== undefined) {
				result[key] = value
				hasCaptures = true
			}
		}
	}

	for (let i = 1; i < match.length; i++) {
		if (match[i] !== undefined) {
			result[String(i)] = match[i]
			hasCaptures = true
		}
	}

	return hasCaptures ? result : null
}

/**
 * Determines when a process should be considered "ready"
 * based on its configuration.
 */
export function createReadinessChecker(config: ResolvedProcessConfig) {
	const shouldCapture = config.readyPattern instanceof RegExp
	const pattern: RegExp | null = config.readyPattern
		? config.readyPattern instanceof RegExp
			? config.readyPattern
			: new RegExp(config.readyPattern)
		: null
	const persistent = config.persistent !== false
	let outputBuffer = ''
	let _captures: Record<string, string> | null = null

	return {
		/**
		 * Feed process output data. Returns true if the process
		 * should now be considered ready.
		 */
		feedOutput(data: string): boolean {
			if (!(persistent && pattern)) return false
			outputBuffer += data
			if (outputBuffer.length > BUFFER_CAP) {
				outputBuffer = outputBuffer.slice(-BUFFER_CAP)
			}
			const clean = stripAnsi(outputBuffer)
			if (!shouldCapture) return pattern.test(clean)
			const match = pattern.exec(clean)
			if (match) {
				_captures = extractCaptures(match)
				return true
			}
			return false
		},

		/** Captured groups from the readyPattern match, or null if not a RegExp / no groups / not yet matched */
		get captures(): Record<string, string> | null {
			return _captures
		},

		/**
		 * Returns true if the process is immediately ready on spawn
		 * (persistent with no readyPattern).
		 */
		get isImmediatelyReady(): boolean {
			return persistent && !pattern
		},

		/**
		 * Returns true if readiness depends on exit code
		 * (non-persistent processes).
		 */
		get dependsOnExit(): boolean {
			return !persistent
		}
	}
}
