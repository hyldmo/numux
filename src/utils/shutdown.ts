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
		app.shutdown().finally(() => logWriter?.close())
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		log('Uncaught exception:', err?.message ?? err)
		app.shutdown().finally(() => {
			logWriter?.close()
			process.exit(1)
		})
	})
}
