import type { LogWriter } from './log-writer'
import { log } from './logger'

export interface ShutdownTarget {
	shutdown: () => Promise<void>
	hasFailures: () => boolean
}

let finalized = false

/** Print log dir and cleanup, then exit. Idempotent — only prints once. */
export function finalizeShutdown(logWriter: LogWriter | undefined, exitCode: number): never {
	if (finalized) process.exit(exitCode)
	finalized = true
	if (logWriter && !logWriter.isTemporary) {
		process.stderr.write(`Logs saved to: ${logWriter.getDirectory()}\n`)
	}
	logWriter?.cleanup()
	process.exit(exitCode)
}

export function setupShutdownHandlers(target: ShutdownTarget, logWriter?: LogWriter): void {
	let shuttingDown = false

	const shutdown = () => {
		if (shuttingDown) {
			process.exit(1)
		}
		shuttingDown = true
		target.shutdown().finally(() => {
			finalizeShutdown(logWriter, target.hasFailures() ? 1 : 0)
		})
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		log('Uncaught exception:', err?.message ?? err)
		target.shutdown().finally(() => {
			process.stderr.write(`numux: unexpected error: ${err?.stack ?? err}\n`)
			logWriter?.cleanup()
			process.exit(1)
		})
	})

	process.on('unhandledRejection', (reason: unknown) => {
		const stack = reason instanceof Error ? reason.stack : String(reason)
		log('Unhandled rejection:', stack)
		target.shutdown().finally(() => {
			process.stderr.write(`numux: unhandled rejection: ${stack}\n`)
			logWriter?.cleanup()
			process.exit(1)
		})
	})
}
