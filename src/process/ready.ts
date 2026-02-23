import type { NumuxProcessConfig } from '../types'

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
