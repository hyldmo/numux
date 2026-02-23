import { describe, expect, test } from 'bun:test'
import { buildConfigFromArgs, parseArgs } from './cli'

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
})
