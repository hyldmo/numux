console.info('Deploy to staging? [y/n]')

const reader = Bun.stdin.stream().getReader()
const decoder = new TextDecoder()

while (true) {
	const { value, done } = await reader.read()
	if (done) break
	const input = decoder.decode(value).trim().toLowerCase()
	if (input === 'y') {
		console.info('deploying to staging...')
		await Bun.sleep(2000)
		console.info('deploy complete!')
		process.exit(0)
	} else if (input === 'n') {
		console.info('deploy cancelled.')
		process.exit(0)
	} else {
		console.info(`unknown input: "${input}" — type y or n`)
	}
}
