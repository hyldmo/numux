import type { NumuxProcessConfig } from '../types'
import { stripAnsi } from '../utils/color'

/** Keep the last 64 KB of output for pattern matching */
const BUFFER_CAP = 65_536

// biome-ignore lint/suspicious/noControlCharactersInRegex: SGR matching requires control chars
const SGR_RE = /\x1b\[([0-9;]*)m/g

/** Check if text contains ANSI SGR codes for red (param 31 or 91) */
function hasAnsiRed(text: string): boolean {
	SGR_RE.lastIndex = 0
	for (let match = SGR_RE.exec(text); match !== null; match = SGR_RE.exec(text)) {
		const params = match[1].split(';')
		if (params.includes('31') || params.includes('91')) return true
	}
	return false
}

/**
 * Determines when a process has emitted error output.
 * Returns null when errorMatcher is not configured.
 */
export function createErrorChecker(config: NumuxProcessConfig) {
	const matcher = config.errorMatcher
	if (!matcher) return null

	const pattern = typeof matcher === 'string' ? new RegExp(matcher) : null
	let buffer = ''
	let triggered = false

	return {
		/**
		 * Feed process output data. Returns true the first time
		 * an error is detected (one-shot).
		 */
		feedOutput(data: string): boolean {
			if (triggered) return false
			buffer += data
			if (buffer.length > BUFFER_CAP) {
				buffer = buffer.slice(-BUFFER_CAP)
			}
			if (pattern) {
				if (pattern.test(stripAnsi(buffer))) {
					triggered = true
					return true
				}
			} else if (hasAnsiRed(buffer)) {
				triggered = true
				return true
			}
			return false
		}
	}
}
