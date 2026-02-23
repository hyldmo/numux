#!/usr/bin/env bun
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildConfigFromArgs, filterConfig, parseArgs } from './cli'
import { generateCompletions } from './completions'
import { loadConfig } from './config/loader'
import { resolveDependencyTiers } from './config/resolver'
import { type ValidationWarning, validateConfig } from './config/validator'
import { ProcessManager } from './process/manager'
import type { ResolvedNumuxConfig } from './types'
import { App } from './ui/app'
import { PrefixDisplay } from './ui/prefix'
import { LogWriter } from './utils/log-writer'
import { enableDebugLog } from './utils/logger'
import { setupShutdownHandlers } from './utils/shutdown'

const HELP = `numux — terminal multiplexer with dependency orchestration

Usage:
  numux                          Run processes from config file
  numux <cmd1> <cmd2> ...        Run ad-hoc commands in parallel
  numux -n name1=cmd1 -n name2=cmd2  Named ad-hoc commands
  numux init                     Create a starter config file
  numux validate                 Validate config and show process graph
  numux completions <shell>      Generate shell completions (bash, zsh, fish)

Options:
  -n, --name <name=command>  Add a named process
  -c, --config <path>        Config file path (default: auto-detect)
  -p, --prefix               Prefixed output mode (no TUI, for CI/scripts)
  --only <a,b,...>           Only run these processes (+ their dependencies)
  --exclude <a,b,...>        Exclude these processes
  --kill-others              Kill all processes when any exits
  --no-restart               Disable auto-restart for crashed processes
  --no-watch                 Disable file watching even if config has watch patterns
  -t, --timestamps           Add timestamps to prefixed output lines
  --log-dir <path>           Write per-process logs to directory
  --debug                    Enable debug logging to .numux/debug.log
  -h, --help                 Show this help
  -v, --version              Show version

Config files (auto-detected):
  numux.config.ts, numux.config.js, numux.config.yaml,
  numux.config.yml, numux.config.json,
  or "numux" key in package.json`

const INIT_TEMPLATE = `import { defineConfig } from 'numux'

export default defineConfig({
  processes: {
    // dev: 'npm run dev',
    // api: {
    //   command: 'npm run dev:api',
    //   readyPattern: 'listening on port',
    // },
    // web: {
    //   command: 'npm run dev:web',
    //   dependsOn: ['api'],
    // },
  },
})
`

async function main() {
	const parsed = parseArgs(process.argv)

	if (parsed.help) {
		console.info(HELP)
		process.exit(0)
	}

	if (parsed.version) {
		const pkg = await import('../package.json')
		console.info(`numux v${(pkg.default ?? pkg).version}`)
		process.exit(0)
	}

	if (parsed.init) {
		const target = resolve('numux.config.ts')
		if (existsSync(target)) {
			console.error(`Already exists: ${target}`)
			process.exit(1)
		}
		writeFileSync(target, INIT_TEMPLATE)
		console.info(`Created ${target}`)
		process.exit(0)
	}

	if (parsed.completions) {
		console.info(generateCompletions(parsed.completions))
		process.exit(0)
	}

	if (parsed.validate) {
		const raw = await loadConfig(parsed.configPath)
		const warnings: ValidationWarning[] = []
		let config = validateConfig(raw, warnings)

		if (parsed.only || parsed.exclude) {
			config = filterConfig(config, parsed.only, parsed.exclude)
		}

		const tiers = resolveDependencyTiers(config)
		const names = Object.keys(config.processes)
		const filterNote = parsed.only || parsed.exclude ? ' (filtered)' : ''
		console.info(`Config valid: ${names.length} process${names.length === 1 ? '' : 'es'}${filterNote}\n`)
		for (let i = 0; i < tiers.length; i++) {
			console.info(`Tier ${i}:`)
			for (const name of tiers[i]) {
				const proc = config.processes[name]
				const flags: string[] = []
				if (proc.dependsOn?.length) flags.push(`depends on: ${proc.dependsOn.join(', ')}`)
				if (proc.readyPattern) flags.push(`ready: /${proc.readyPattern}/`)
				if (proc.persistent === false) flags.push('one-shot')
				if (proc.delay) flags.push(`delay: ${proc.delay}ms`)
				if (proc.condition) flags.push(`if: ${proc.condition}`)
				if (proc.watch) {
					const patterns = Array.isArray(proc.watch) ? proc.watch : [proc.watch]
					flags.push(`watch: ${patterns.join(', ')}`)
				}
				const suffix = flags.length > 0 ? `  (${flags.join(', ')})` : ''
				console.info(`  ${name}: ${proc.command}${suffix}`)
			}
		}
		printWarnings(warnings)
		process.exit(0)
	}

	if (parsed.debug) {
		enableDebugLog()
	}

	let config: ResolvedNumuxConfig
	const warnings: ValidationWarning[] = []

	if (parsed.commands.length > 0 || parsed.named.length > 0) {
		config = buildConfigFromArgs(parsed.commands, parsed.named, { noRestart: parsed.noRestart })
	} else {
		const raw = await loadConfig(parsed.configPath)
		config = validateConfig(raw, warnings)

		if (parsed.noRestart) {
			for (const proc of Object.values(config.processes)) {
				proc.maxRestarts = 0
			}
		}
	}

	if (parsed.noWatch) {
		for (const proc of Object.values(config.processes)) {
			delete proc.watch
		}
	}

	if (parsed.only || parsed.exclude) {
		config = filterConfig(config, parsed.only, parsed.exclude)
	}

	const manager = new ProcessManager(config)

	let logWriter: LogWriter | undefined
	if (parsed.logDir) {
		logWriter = new LogWriter(parsed.logDir)
	}

	printWarnings(warnings)

	if (parsed.prefix) {
		const display = new PrefixDisplay(manager, config, {
			logWriter,
			killOthers: parsed.killOthers,
			timestamps: parsed.timestamps
		})
		await display.start()
	} else {
		if (logWriter) {
			manager.on(logWriter.handleEvent)
		}
		const app = new App(manager, config)
		setupShutdownHandlers(app, logWriter)
		await app.start()
	}
}

function printWarnings(warnings: ValidationWarning[]): void {
	for (const w of warnings) {
		console.warn(`Warning: process "${w.process}": ${w.message}`)
	}
}

main().catch(err => {
	console.error(err instanceof Error ? err.message : err)
	process.exit(1)
})
