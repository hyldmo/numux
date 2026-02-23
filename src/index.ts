#!/usr/bin/env bun
import { loadConfig } from './config/loader'
import { validateConfig } from './config/validator'
import { ProcessManager } from './process/manager'
import { App } from './ui/app'
import { enableDebugLog } from './utils/logger'
import { setupShutdownHandlers } from './utils/shutdown'

async function main() {
	if (process.argv.includes('--debug')) {
		enableDebugLog()
	}

	const raw = await loadConfig()
	const config = validateConfig(raw)
	const manager = new ProcessManager(config)
	const app = new App(manager)

	setupShutdownHandlers(app)
	await app.start()
}

main().catch(err => {
	console.error(err)
	process.exit(1)
})
