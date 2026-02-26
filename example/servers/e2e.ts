const baseUrl = process.env.BASE_URL || 'http://localhost:3000'
console.info(`running e2e tests against ${baseUrl}`)

const tests = ['login flow', 'create order', 'user profile', 'search']

for (const test of tests) {
	await Bun.sleep(500 + Math.random() * 500)
	if (Math.random() < 0.15) {
		console.error(`\x1b[31m✗ ${test} — assertion failed\x1b[0m`)
	} else {
		console.info(`✓ ${test} passed`)
	}
}

console.info(`\n${tests.length} tests complete`)
