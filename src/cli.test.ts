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

	test('--config sets config path', () => {
		expect(parseArgs(argv('--config', 'my.config.ts')).configPath).toBe('my.config.ts')
	})

	test('-e sets env file path', () => {
		expect(parseArgs(argv('-e', '.env.local')).envFile).toBe('.env.local')
	})

	test('--env-file sets env file path', () => {
		expect(parseArgs(argv('--env-file', '.env.local')).envFile).toBe('.env.local')
	})

	test('-e false disables env file loading', () => {
		expect(parseArgs(argv('-e', 'false')).envFile).toBe(false)
	})

	test('-c sets colors', () => {
		expect(parseArgs(argv('-c', '#ff0000,#00ff00')).colors).toEqual(['#ff0000', '#00ff00'])
	})

	test('--color sets colors', () => {
		expect(parseArgs(argv('--color', '#ff0000')).colors).toEqual(['#ff0000'])
	})

	test('--color trims whitespace', () => {
		expect(parseArgs(argv('--color', '#ff0 , #0f0')).colors).toEqual(['#ff0', '#0f0'])
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
		const result = parseArgs(argv('--debug', '-n', 'db=docker compose up', 'echo hello', '--config', 'custom.json'))
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

	test('validate with --config path', () => {
		const result = parseArgs(argv('validate', '--config', 'custom.json'))
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

	test('--max-restarts parses integer', () => {
		expect(parseArgs(argv('--max-restarts', '3')).maxRestarts).toBe(3)
	})

	test('--max-restarts 0 is valid', () => {
		expect(parseArgs(argv('--max-restarts', '0')).maxRestarts).toBe(0)
	})

	test('--max-restarts rejects negative', () => {
		expect(() => parseArgs(argv('--max-restarts', '-1'))).toThrow('non-negative integer')
	})

	test('--max-restarts rejects non-integer', () => {
		expect(() => parseArgs(argv('--max-restarts', 'abc'))).toThrow('non-negative integer')
	})

	test('maxRestarts is undefined by default', () => {
		expect(parseArgs(argv()).maxRestarts).toBeUndefined()
	})

	test('--no-watch sets noWatch flag', () => {
		expect(parseArgs(argv('--no-watch')).noWatch).toBe(true)
	})

	test('noWatch is false by default', () => {
		expect(parseArgs(argv()).noWatch).toBe(false)
	})

	test('-s sets sort', () => {
		expect(parseArgs(argv('-s', 'alphabetical')).sort).toBe('alphabetical')
	})

	test('--sort sets sort', () => {
		expect(parseArgs(argv('--sort', 'topological')).sort).toBe('topological')
	})

	test('sort is undefined by default', () => {
		expect(parseArgs(argv()).sort).toBeUndefined()
	})

	test('--colors sets autoColors flag', () => {
		expect(parseArgs(argv('--colors')).autoColors).toBe(true)
	})

	test('autoColors is false by default', () => {
		expect(parseArgs(argv()).autoColors).toBe(false)
	})

	test('exec parses process name and command', () => {
		const result = parseArgs(argv('exec', 'api', 'npx', 'prisma', 'migrate'))
		expect(result.exec).toBe(true)
		expect(result.execName).toBe('api')
		expect(result.execCommand).toBe('npx prisma migrate')
	})

	test('exec supports -- separator', () => {
		const result = parseArgs(argv('exec', 'api', '--', 'npx', 'prisma', 'migrate', '--force'))
		expect(result.exec).toBe(true)
		expect(result.execName).toBe('api')
		expect(result.execCommand).toBe('npx prisma migrate --force')
	})

	test('exec requires a process name', () => {
		expect(() => parseArgs(argv('exec'))).toThrow('exec requires a process name')
	})

	test('exec requires a command', () => {
		expect(() => parseArgs(argv('exec', 'api'))).toThrow('exec requires a command')
	})

	test('exec with --config flag', () => {
		const result = parseArgs(argv('--config', 'custom.json', 'exec', 'api', 'echo', 'hi'))
		expect(result.exec).toBe(true)
		expect(result.configPath).toBe('custom.json')
		expect(result.execName).toBe('api')
		expect(result.execCommand).toBe('echo hi')
	})

	test('throws on missing value for --config', () => {
		expect(() => parseArgs(argv('--config'))).toThrow('Missing value for --config')
	})

	test('throws on missing value for -c', () => {
		expect(() => parseArgs(argv('-c'))).toThrow('Missing value for -c')
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

	test('accepts values starting with - for flag arguments', () => {
		expect(parseArgs(argv('--config', '-my-config.ts')).configPath).toBe('-my-config.ts')
		expect(parseArgs(argv('--log-dir', '-logs')).logDir).toBe('-logs')
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
