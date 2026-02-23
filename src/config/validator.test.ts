import { describe, expect, test } from 'bun:test'
import { validateConfig } from './validator'

describe('validateConfig', () => {
	test('accepts a valid config', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hello' }
			}
		})
		expect(config.processes.web.command).toBe('echo hello')
		expect(config.processes.web.persistent).toBe(true)
	})

	test('applies defaults for optional fields', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi' }
			}
		})
		expect(config.processes.web.cwd).toBeUndefined()
		expect(config.processes.web.env).toBeUndefined()
		expect(config.processes.web.dependsOn).toBeUndefined()
		expect(config.processes.web.readyPattern).toBeUndefined()
		expect(config.processes.web.persistent).toBe(true)
		expect(config.processes.web.color).toBeUndefined()
	})

	test('preserves explicit persistent: false', () => {
		const config = validateConfig({
			processes: {
				migrate: { command: 'bun run migrate', persistent: false }
			}
		})
		expect(config.processes.migrate.persistent).toBe(false)
	})

	test('preserves dependsOn array', () => {
		const config = validateConfig({
			processes: {
				db: { command: 'echo db' },
				api: { command: 'echo api', dependsOn: ['db'] }
			}
		})
		expect(config.processes.api.dependsOn).toEqual(['db'])
	})

	test('throws on null/undefined input', () => {
		expect(() => validateConfig(null)).toThrow('Config must be an object')
		expect(() => validateConfig(undefined)).toThrow('Config must be an object')
	})

	test('throws on missing processes key', () => {
		expect(() => validateConfig({})).toThrow('must have a "processes" object')
	})

	test('throws on empty processes', () => {
		expect(() => validateConfig({ processes: {} })).toThrow('at least one process')
	})

	test('throws on missing command', () => {
		expect(() => validateConfig({ processes: { web: {} } })).toThrow('non-empty "command" string')
	})

	test('throws on empty command', () => {
		expect(() => validateConfig({ processes: { web: { command: '  ' } } })).toThrow('non-empty "command" string')
	})

	test('throws on unknown dependency', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', dependsOn: ['db'] }
				}
			})
		).toThrow('unknown process "db"')
	})

	test('throws on self-dependency', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', dependsOn: ['web'] }
				}
			})
		).toThrow('cannot depend on itself')
	})

	test('preserves explicit maxRestarts', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', maxRestarts: 3 }
			}
		})
		expect(config.processes.web.maxRestarts).toBe(3)
	})

	test('preserves maxRestarts: 0', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', maxRestarts: 0 }
			}
		})
		expect(config.processes.web.maxRestarts).toBe(0)
	})

	test('ignores negative maxRestarts', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', maxRestarts: -1 }
			}
		})
		expect(config.processes.web.maxRestarts).toBeUndefined()
	})

	test('ignores non-number maxRestarts', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', maxRestarts: 'abc' }
			}
		})
		expect(config.processes.web.maxRestarts).toBeUndefined()
	})

	test('throws on non-array dependsOn', () => {
		expect(() =>
			validateConfig({
				processes: {
					db: { command: 'echo db' },
					web: { command: 'echo hi', dependsOn: 'db' }
				}
			})
		).toThrow('dependsOn must be an array')
	})
})
