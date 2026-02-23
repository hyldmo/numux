#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const child = spawn('bun', ['run', join(__dirname, 'numux.js'), ...process.argv.slice(2)], {
	stdio: 'inherit'
})

child.on('exit', (code, signal) => {
	if (signal) process.kill(process.pid, signal)
	else process.exit(code ?? 1)
})

child.on('error', err => {
	if (err.code === 'ENOENT') {
		console.error('numux requires bun. Install it: https://bun.sh')
	} else {
		console.error(err.message)
	}
	process.exit(1)
})
