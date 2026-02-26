const methods = ['GET', 'GET', 'GET', 'POST', 'PUT', 'DELETE'] as const
const paths = ['/users', '/users/42', '/orders', '/orders/17', '/health', '/products', '/auth/login'] as const
const statuses = [200, 200, 200, 200, 201, 204, 304, 400, 404, 500] as const

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

const port = 3000 + Math.floor(Math.random() * 1000)

console.info('booting API server...')
await Bun.sleep(300)
console.info('connecting to database...')
await Bun.sleep(200)
console.info(`listening on http://localhost:${port}`)

const requestLoop = setInterval(
	() => {
		const method = pick(methods)
		const path = pick(paths)
		const status = pick(statuses)
		const duration = Math.floor(Math.random() * 150) + 5
		console.info(`${method} ${path} → ${status} (${duration}ms)`)
	},
	1000 + Math.random() * 2000
)

const shutdown = () => {
	console.info('graceful shutdown started')
	clearInterval(requestLoop)
	console.info('server closed')
	process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
