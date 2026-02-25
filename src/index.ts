#!/usr/bin/env bun
import { existsSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildConfigFromArgs, filterConfig, parseArgs } from './cli'
import { generateHelp } from './cli-flags'
import { generateCompletions } from './completions'
import { expandScriptPatterns } from './config/expand-scripts'
import { loadConfig } from './config/loader'
import { resolveDependencyTiers } from './config/resolver'
import { type ValidationWarning, validateConfig } from './config/validator'
import { resolveWorkspaceProcesses } from './config/workspaces'
import { ProcessManager } from './process/manager'
import type { NumuxProcessConfig, ResolvedNumuxConfig } from './types'
import { App } from './ui/app'
import { PrefixDisplay } from './ui/prefix'
import { colorFromName } from './utils/color'
import { loadEnvFiles } from './utils/env-file'
import { LogWriter } from './utils/log-writer'
import { enableDebugLog } from './utils/logger'
import { setupShutdownHandlers } from './utils/shutdown'

const HELP = generateHelp()

const INIT_TEMPLATE = `import { defineConfig } from 'numux'

export default defineConfig({
  // Global options (inherited by all processes):
  // cwd: './packages/backend',
  // env: { NODE_ENV: 'development' },
  // envFile: '.env',

  processes: {
    // dev: 'npm run dev',
    // api: {
    //   command: 'npm run dev:api',
    //   readyPattern: 'listening on port',
    //   watch: 'src/**/*.ts',
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
		const raw = expandScriptPatterns(await loadConfig(parsed.configPath))
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

	if (parsed.exec) {
		const raw = expandScriptPatterns(await loadConfig(parsed.configPath))
		const config = validateConfig(raw)
		const proc = config.processes[parsed.execName!]
		if (!proc) {
			const names = Object.keys(config.processes)
			throw new Error(`Unknown process "${parsed.execName}". Available: ${names.join(', ')}`)
		}

		const cwd = proc.cwd ? resolve(proc.cwd) : process.cwd()
		const envFromFile = proc.envFile ? loadEnvFiles(proc.envFile, cwd) : {}
		const env: Record<string, string> = {
			...(process.env as Record<string, string>),
			...envFromFile,
			...proc.env
		}

		const child = Bun.spawn(['sh', '-c', parsed.execCommand!], {
			cwd,
			env,
			stdout: 'inherit',
			stdin: 'inherit',
			stderr: 'inherit'
		})
		process.exit(await child.exited)
	}

	if (parsed.debug) {
		enableDebugLog()
	}

	let config: ResolvedNumuxConfig
	const warnings: ValidationWarning[] = []

	if (parsed.commands.length > 0 || parsed.named.length > 0 || parsed.workspace) {
		const isScriptPattern = (c: string) => c.startsWith('npm:') || /[*?[]/.test(c)
		const hasNpmPatterns = parsed.commands.some(isScriptPattern)
		if (hasNpmPatterns) {
			// Expand npm:/glob patterns into named processes, pass remaining commands as-is
			const npmPatterns = parsed.commands.filter(isScriptPattern)
			const otherCommands = parsed.commands.filter(c => !isScriptPattern(c))
			const processes: Record<string, NumuxProcessConfig | string> = {}
			for (const pattern of npmPatterns) {
				const entry: Partial<NumuxProcessConfig> = {}
				if (parsed.colors?.length) entry.color = parsed.colors
				processes[pattern] = entry as NumuxProcessConfig
			}
			for (let i = 0; i < otherCommands.length; i++) {
				const cmd = otherCommands[i]
				let name = cmd.split(/\s+/)[0].split('/').pop()!
				if (processes[name]) name = `${name}-${i}`
				processes[name] = cmd
			}
			for (const { name, command } of parsed.named) {
				processes[name] = command
			}
			const expanded = expandScriptPatterns({ processes })
			config = validateConfig(expanded, warnings)
		} else {
			config = buildConfigFromArgs(parsed.commands, parsed.named, {
				noRestart: parsed.noRestart,
				colors: parsed.colors
			})
		}

		// Merge workspace processes if -w was specified
		if (parsed.workspace) {
			const wsProcesses = resolveWorkspaceProcesses(parsed.workspace, process.cwd())
			for (const [name, proc] of Object.entries(wsProcesses)) {
				let finalName = name
				if (config.processes[finalName]) {
					let suffix = 1
					while (config.processes[`${finalName}-${suffix}`]) suffix++
					finalName = `${finalName}-${suffix}`
				}
				if (parsed.noRestart) proc.maxRestarts = 0
				config.processes[finalName] = proc
			}
		}
	} else {
		const raw = expandScriptPatterns(await loadConfig(parsed.configPath))
		config = validateConfig(raw, warnings)

		if (parsed.noRestart) {
			for (const proc of Object.values(config.processes)) {
				proc.maxRestarts = 0
			}
		}
	}

	if (parsed.envFile !== undefined) {
		for (const proc of Object.values(config.processes)) {
			proc.envFile = parsed.envFile
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

	if (parsed.autoColors) {
		for (const [name, proc] of Object.entries(config.processes)) {
			if (!proc.color) {
				proc.color = colorFromName(name)
			}
		}
	}

	const manager = new ProcessManager(config)

	let logWriter: LogWriter | undefined
	if (parsed.logDir) {
		logWriter = new LogWriter(parsed.logDir)
	}

	printWarnings(warnings)

	if (parsed.prefix) {
		// Default to no restarts in prefix mode (CI/scripts)
		if (!parsed.noRestart) {
			for (const proc of Object.values(config.processes)) {
				proc.maxRestarts ??= 0
			}
		}
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
