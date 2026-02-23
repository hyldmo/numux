import type { App } from '../ui/app'

export function setupShutdownHandlers(app: App): void {
	const shutdown = () => {
		app.shutdown()
	}

	process.on('SIGINT', shutdown)
	process.on('SIGTERM', shutdown)
	process.on('uncaughtException', err => {
		console.error('Uncaught exception:', err)
		shutdown()
	})
}
