import type { NumuxProcessConfig } from '../types'

/** Keep the last 64 KB of output for pattern matching */
const BUFFER_CAP = 65_536

/**
 * Determines when a process should be considered "ready"
 * based on its configuration.
 */
export function createReadinessChecker(config: NumuxProcessConfig) {
	const pattern = config.readyPattern ? new RegExp(config.readyPattern) : null
	const persistent = config.persistent !== false
	let outputBuffer = ''

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
			return pattern.test(outputBuffer)
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
