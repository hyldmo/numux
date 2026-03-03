import type { LogWriter } from './log-writer'
import { log } from './logger'

export interface ShutdownTarget {
	shutdown: () => Promise<void>
	hasFailures: () => boolean
}

export function setupShutdownHandlers(target: ShutdownTarget, logWriter?: LogWriter): void {
	let shuttingDown = false

	const shutdown = () => {
		if (shuttingDown) {
			process.exit(1)
		}
		shuttingDown = true
		target.shutdown().finally(() => {
			if (logWriter && !logWriter.isTemporary) {
				process.stderr.write(`Logs saved to: ${logWriter.getDirectory()}\n`)
			}
			logWriter?.cleanup()
			process.exit(target.hasFailures() ? 1 : 0)
		})
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		log('Uncaught exception:', err?.message ?? err)
		process.stderr.write(`numux: unexpected error: ${err?.stack ?? err}\n`)
		target.shutdown().finally(() => {
			logWriter?.cleanup()
			process.exit(1)
		})
	})

	process.on('unhandledRejection', (reason: unknown) => {
		const message = reason instanceof Error ? reason.message : String(reason)
		log('Unhandled rejection:', message)
		process.stderr.write(`numux: unhandled rejection: ${message}\n`)
		target.shutdown().finally(() => {
			logWriter?.cleanup()
			process.exit(1)
		})
	})
}
