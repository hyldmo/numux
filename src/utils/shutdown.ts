import type { App } from '../ui/app'
import { log } from './logger'

export function setupShutdownHandlers(app: App): void {
	let shuttingDown = false

	const shutdown = () => {
		if (shuttingDown) {
			process.exit(1)
		}
		shuttingDown = true
		app.shutdown()
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		log('Uncaught exception:', err?.message ?? err)
		app.shutdown().finally(() => {
			process.exit(1)
		})
	})
}
