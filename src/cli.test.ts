import { describe, expect, test } from 'bun:test'
import { buildConfigFromArgs, filterConfig, parseArgs } from './cli'
import type { ResolvedNumuxConfig } from './types'

/** Helper: simulates argv with bun + script prefix */
function argv(...args: string[]): string[] {
	return ['bun', 'src/index.ts', ...args]
}

describe('parseArgs', () => {
	test('no arguments → all defaults', () => {
		const result = parseArgs(argv())
		expect(result.help).toBe(false)
		expect(result.version).toBe(false)
		expect(result.debug).toBe(false)
		expect(result.prefix).toBe(false)
		expect(result.configPath).toBeUndefined()
		expect(result.commands).toEqual([])
		expect(result.named).toEqual([])
	})

	test('-h sets help flag', () => {
		expect(parseArgs(argv('-h')).help).toBe(true)
	})

	test('--help sets help flag', () => {
		expect(parseArgs(argv('--help')).help).toBe(true)
	})

	test('-v sets version flag', () => {
		expect(parseArgs(argv('-v')).version).toBe(true)
	})

	test('--version sets version flag', () => {
		expect(parseArgs(argv('--version')).version).toBe(true)
	})

	test('--debug sets debug flag', () => {
		expect(parseArgs(argv('--debug')).debug).toBe(true)
	})

	test('-p sets prefix flag', () => {
		expect(parseArgs(argv('-p')).prefix).toBe(true)
	})

	test('--prefix sets prefix flag', () => {
		expect(parseArgs(argv('--prefix')).prefix).toBe(true)
	})

	test('prefix is false by default', () => {
		expect(parseArgs(argv()).prefix).toBe(false)
	})

	test('--kill-others sets killOthers flag', () => {
		expect(parseArgs(argv('--kill-others')).killOthers).toBe(true)
	})

	test('killOthers is false by default', () => {
		expect(parseArgs(argv()).killOthers).toBe(false)
	})

	test('-t sets timestamps flag', () => {
		expect(parseArgs(argv('-t')).timestamps).toBe(true)
	})

	test('--timestamps sets timestamps flag', () => {
		expect(parseArgs(argv('--timestamps')).timestamps).toBe(true)
	})

	test('timestamps is false by default', () => {
		expect(parseArgs(argv()).timestamps).toBe(false)
	})

	test('-c sets config path', () => {
		expect(parseArgs(argv('-c', 'my.config.ts')).configPath).toBe('my.config.ts')
	})

	test('--config sets config path', () => {
		expect(parseArgs(argv('--config', 'path/to/config.json')).configPath).toBe('path/to/config.json')
	})

	test('positional args become commands', () => {
		const result = parseArgs(argv('echo hello', 'npm start'))
		expect(result.commands).toEqual(['echo hello', 'npm start'])
	})

	test('-n parses named process', () => {
		const result = parseArgs(argv('-n', 'api=bun run dev'))
		expect(result.named).toEqual([{ name: 'api', command: 'bun run dev' }])
	})

	test('--name parses named process', () => {
		const result = parseArgs(argv('--name', 'web=npm start'))
		expect(result.named).toEqual([{ name: 'web', command: 'npm start' }])
	})

	test('multiple -n flags accumulate', () => {
		const result = parseArgs(argv('-n', 'api=echo api', '-n', 'web=echo web'))
		expect(result.named).toHaveLength(2)
		expect(result.named[0].name).toBe('api')
		expect(result.named[1].name).toBe('web')
	})

	test('mixed flags, commands, and named processes', () => {
		const result = parseArgs(argv('--debug', '-n', 'db=docker compose up', 'echo hello', '-c', 'custom.json'))
		expect(result.debug).toBe(true)
		expect(result.configPath).toBe('custom.json')
		expect(result.commands).toEqual(['echo hello'])
		expect(result.named).toEqual([{ name: 'db', command: 'docker compose up' }])
	})

	test('named process with = in command value', () => {
		const result = parseArgs(argv('-n', 'env=KEY=VALUE echo test'))
		expect(result.named).toEqual([{ name: 'env', command: 'KEY=VALUE echo test' }])
	})

	test('--log-dir sets logDir', () => {
		expect(parseArgs(argv('--log-dir', './logs')).logDir).toBe('./logs')
	})

	test('--only parses comma-separated names', () => {
		const result = parseArgs(argv('--only', 'api,web'))
		expect(result.only).toEqual(['api', 'web'])
	})

	test('--only trims whitespace', () => {
		const result = parseArgs(argv('--only', 'api , web'))
		expect(result.only).toEqual(['api', 'web'])
	})

	test('--exclude parses comma-separated names', () => {
		const result = parseArgs(argv('--exclude', 'migrate'))
		expect(result.exclude).toEqual(['migrate'])
	})

	test('--only and --exclude can coexist', () => {
		const result = parseArgs(argv('--only', 'api,web,db', '--exclude', 'db'))
		expect(result.only).toEqual(['api', 'web', 'db'])
		expect(result.exclude).toEqual(['db'])
	})

	test('init sets init flag', () => {
		expect(parseArgs(argv('init')).init).toBe(true)
	})

	test('init is false by default', () => {
		expect(parseArgs(argv()).init).toBe(false)
	})

	test('validate sets validate flag', () => {
		expect(parseArgs(argv('validate')).validate).toBe(true)
	})

	test('validate is false by default', () => {
		expect(parseArgs(argv()).validate).toBe(false)
	})

	test('validate with -c config path', () => {
		const result = parseArgs(argv('validate', '-c', 'custom.json'))
		expect(result.validate).toBe(true)
		expect(result.configPath).toBe('custom.json')
	})

	test('completions parses shell argument', () => {
		expect(parseArgs(argv('completions', 'bash')).completions).toBe('bash')
		expect(parseArgs(argv('completions', 'zsh')).completions).toBe('zsh')
		expect(parseArgs(argv('completions', 'fish')).completions).toBe('fish')
	})

	test('completions requires a shell argument', () => {
		expect(() => parseArgs(argv('completions'))).toThrow('Missing value for completions')
	})

	test('--no-restart sets noRestart flag', () => {
		expect(parseArgs(argv('--no-restart')).noRestart).toBe(true)
	})

	test('noRestart is false by default', () => {
		expect(parseArgs(argv()).noRestart).toBe(false)
	})

	test('throws on missing value for -c', () => {
		expect(() => parseArgs(argv('-c'))).toThrow('Missing value for -c')
	})

	test('throws on missing value for --config', () => {
		expect(() => parseArgs(argv('--config'))).toThrow('Missing value for --config')
	})

	test('throws on missing value for --log-dir', () => {
		expect(() => parseArgs(argv('--log-dir'))).toThrow('Missing value for --log-dir')
	})

	test('throws on missing value for --only', () => {
		expect(() => parseArgs(argv('--only'))).toThrow('Missing value for --only')
	})

	test('throws on missing value for -n', () => {
		expect(() => parseArgs(argv('-n'))).toThrow('Missing value for -n')
	})

	test('throws on flag-like value for -c', () => {
		expect(() => parseArgs(argv('-c', '--debug'))).toThrow('Missing value for -c')
	})

	test('throws on invalid --name format (no equals)', () => {
		expect(() => parseArgs(argv('-n', 'noequals'))).toThrow('Invalid --name value')
	})

	test('throws on unknown option', () => {
		expect(() => parseArgs(argv('--bogus'))).toThrow('Unknown option: --bogus')
	})
})

describe('buildConfigFromArgs', () => {
	test('named processes become config entries', () => {
		const config = buildConfigFromArgs([], [{ name: 'api', command: 'bun run dev' }])
		expect(config.processes.api).toEqual({ command: 'bun run dev', persistent: true })
	})

	test('positional commands get names from first word', () => {
		const config = buildConfigFromArgs(['npm start', 'bun run dev'], [])
		expect(config.processes.npm).toEqual({ command: 'npm start', persistent: true })
		expect(config.processes.bun).toEqual({ command: 'bun run dev', persistent: true })
	})

	test('duplicate command names get index suffix', () => {
		const config = buildConfigFromArgs(['echo hello', 'echo world'], [])
		expect(Object.keys(config.processes)).toHaveLength(2)
		expect(config.processes.echo).toEqual({ command: 'echo hello', persistent: true })
		expect(config.processes['echo-1']).toEqual({ command: 'echo world', persistent: true })
	})

	test('path-based commands use basename', () => {
		const config = buildConfigFromArgs(['/usr/bin/node server.js'], [])
		expect(config.processes.node).toBeDefined()
	})

	test('named and positional can be mixed', () => {
		const config = buildConfigFromArgs(['echo hello'], [{ name: 'api', command: 'bun dev' }])
		expect(Object.keys(config.processes).sort()).toEqual(['api', 'echo'])
	})

	test('noRestart sets maxRestarts: 0 on all processes', () => {
		const config = buildConfigFromArgs(['echo hello'], [{ name: 'api', command: 'bun dev' }], { noRestart: true })
		expect(config.processes.echo.maxRestarts).toBe(0)
		expect(config.processes.api.maxRestarts).toBe(0)
	})

	test('maxRestarts is undefined by default', () => {
		const config = buildConfigFromArgs(['echo hello'], [])
		expect(config.processes.echo.maxRestarts).toBeUndefined()
	})
})

const CHAIN_CONFIG: ResolvedNumuxConfig = {
	processes: {
		db: { command: 'echo db' },
		migrate: { command: 'echo migrate', persistent: false, dependsOn: ['db'] },
		api: { command: 'echo api', dependsOn: ['migrate'] },
		web: { command: 'echo web', dependsOn: ['api'] }
	}
}

describe('filterConfig — --only', () => {
	test('includes named process and its transitive deps', () => {
		const result = filterConfig(CHAIN_CONFIG, ['api'])
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'db', 'migrate'])
	})

	test('includes only the requested leaf', () => {
		const result = filterConfig(CHAIN_CONFIG, ['db'])
		expect(Object.keys(result.processes)).toEqual(['db'])
	})

	test('includes multiple --only targets and their deps', () => {
		const result = filterConfig(CHAIN_CONFIG, ['web', 'db'])
		// web depends on api → migrate → db, so all are included
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'db', 'migrate', 'web'])
	})

	test('throws on unknown --only process', () => {
		expect(() => filterConfig(CHAIN_CONFIG, ['nonexistent'])).toThrow('unknown process "nonexistent"')
	})
})

describe('filterConfig — --exclude', () => {
	test('removes named process', () => {
		const result = filterConfig(CHAIN_CONFIG, undefined, ['web'])
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'db', 'migrate'])
	})

	test('strips removed deps from remaining processes', () => {
		const result = filterConfig(CHAIN_CONFIG, undefined, ['db'])
		// migrate depended on db — that dep should be removed
		expect(result.processes.migrate.dependsOn).toBeUndefined()
	})

	test('throws on unknown --exclude process', () => {
		expect(() => filterConfig(CHAIN_CONFIG, undefined, ['bogus'])).toThrow('unknown process "bogus"')
	})

	test('throws when all processes are excluded', () => {
		expect(() => filterConfig(CHAIN_CONFIG, undefined, ['db', 'migrate', 'api', 'web'])).toThrow(
			'No processes left'
		)
	})
})

describe('filterConfig — --only + --exclude combined', () => {
	test('only pulls in deps, then exclude removes specific ones', () => {
		// --only web pulls in web,api,migrate,db; --exclude migrate removes it
		const result = filterConfig(CHAIN_CONFIG, ['web'], ['migrate'])
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'db', 'web'])
		// api originally depended on migrate, which was excluded
		expect(result.processes.api.dependsOn).toBeUndefined()
	})
})

describe('filterConfig — no-op', () => {
	test('returns full config when neither only nor exclude provided', () => {
		const result = filterConfig(CHAIN_CONFIG)
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'db', 'migrate', 'web'])
	})
})
