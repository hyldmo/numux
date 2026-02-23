const jobTypes = [
	'email.send',
	'report.generate',
	'image.resize',
	'invoice.pdf',
	'cache.invalidate',
	'webhook.deliver'
] as const

const pick = <T>(arr: readonly T[]): T => arr[Math.floor(Math.random() * arr.length)]

console.info('worker starting...')
await Bun.sleep(200)
console.info('connected to job queue')

let jobId = 0

const processJob = () => {
	jobId++
	const type = pick(jobTypes)
	const duration = Math.floor(Math.random() * 800) + 50

	if (Math.random() < 0.1) {
		console.info(`⚠ job #${jobId} (${type}) slow — took ${duration + 2000}ms`)
	} else if (Math.random() < 0.05) {
		console.info(`✗ job #${jobId} (${type}) failed — retrying`)
	} else {
		console.info(`✓ job #${jobId} (${type}) processed in ${duration}ms`)
	}
}

const jobLoop = setInterval(processJob, 2000 + Math.random() * 2000)

const shutdown = () => {
	console.info('draining job queue...')
	clearInterval(jobLoop)
	console.info(`shutdown complete — processed ${jobId} jobs`)
	process.exit(0)
}

process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
