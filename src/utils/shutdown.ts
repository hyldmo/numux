import type { App } from '../ui/app'
import type { LogWriter } from './log-writer'
import { log } from './logger'

export function setupShutdownHandlers(app: App, logWriter?: LogWriter): void {
	let shuttingDown = false

	const shutdown = () => {
		if (shuttingDown) {
			process.exit(1)
		}
		shuttingDown = true
		app.shutdown().finally(() => {
			if (logWriter && !logWriter.isTemporary) {
				process.stderr.write(`Logs saved to: ${logWriter.getDirectory()}\n`)
			}
			logWriter?.cleanup()
			process.exit(app.hasFailures() ? 1 : 0)
		})
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		log('Uncaught exception:', err?.message ?? err)
		process.stderr.write(`numux: unexpected error: ${err?.stack ?? err}\n`)
		app.shutdown().finally(() => {
			logWriter?.cleanup()
			process.exit(1)
		})
	})

	process.on('unhandledRejection', (reason: unknown) => {
		const message = reason instanceof Error ? reason.message : String(reason)
		log('Unhandled rejection:', message)
		process.stderr.write(`numux: unhandled rejection: ${message}\n`)
		app.shutdown().finally(() => {
			logWriter?.cleanup()
			process.exit(1)
		})
	})
}
