import type { App } from '../ui/app'
import type { LogWriter } from './log-writer'
import { log } from './logger'

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

export function setupShutdownHandlers(app: App, logWriter?: LogWriter): void {
	let shuttingDown = false

	const shutdown = () => {
		if (shuttingDown) {
			process.exit(1)
		}
		shuttingDown = true
		app.shutdown().finally(() => {
			finalizeShutdown(logWriter, app.hasFailures() ? 1 : 0)
		})
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		log('Uncaught exception:', err?.message ?? err)
		app.shutdown().finally(() => {
			process.stderr.write(`numux: unexpected error: ${err?.stack ?? err}\n`)
			logWriter?.cleanup()
			process.exit(1)
		})
	})

	process.on('unhandledRejection', (reason: unknown) => {
		const stack = reason instanceof Error ? reason.stack : String(reason)
		log('Unhandled rejection:', stack)
		app.shutdown().finally(() => {
			process.stderr.write(`numux: unhandled rejection: ${stack}\n`)
			logWriter?.cleanup()
			process.exit(1)
		})
	})
}
