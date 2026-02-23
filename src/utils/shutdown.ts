import type { App } from '../ui/app'
import { log } from './logger'

export function setupShutdownHandlers(app: App): void {
	const shutdown = () => {
		app.shutdown()
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		log('Uncaught exception:', err?.message ?? err)
		app.shutdown().catch(() => {
			process.exit(1)
		})
	})
}
