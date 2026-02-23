console.info('initializing shared buffers...')
await Bun.sleep(300)
console.info('loading configuration files...')
await Bun.sleep(200)
console.info('starting WAL writer...')
await Bun.sleep(300)
console.info('recovery complete — database system is ready to accept connections')

const healthCheck = setInterval(() => {
	const connections = Math.floor(Math.random() * 8) + 1
	const queryMs = (Math.random() * 2).toFixed(1)
	console.info(`checkpoint: ${connections} active connections, avg query ${queryMs}ms`)
}, 5000)

const shutdown = () => {
	console.info('received shutdown signal')
	clearInterval(healthCheck)
	console.info('all connections closed — shutting down')
	process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
