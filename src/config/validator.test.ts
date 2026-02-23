import { describe, expect, test } from 'bun:test'
import { type ValidationWarning, validateConfig } from './validator'

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

	test('preserves explicit readyTimeout', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', readyTimeout: 5000 }
			}
		})
		expect(config.processes.web.readyTimeout).toBe(5000)
	})

	test('ignores non-positive readyTimeout', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', readyTimeout: 0 }
			}
		})
		expect(config.processes.web.readyTimeout).toBeUndefined()
	})

	test('ignores non-number readyTimeout', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', readyTimeout: 'abc' }
			}
		})
		expect(config.processes.web.readyTimeout).toBeUndefined()
	})

	test('preserves explicit delay', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', delay: 2000 }
			}
		})
		expect(config.processes.web.delay).toBe(2000)
	})

	test('ignores non-positive delay', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', delay: 0 }
			}
		})
		expect(config.processes.web.delay).toBeUndefined()
	})

	test('ignores non-number delay', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', delay: 'abc' }
			}
		})
		expect(config.processes.web.delay).toBeUndefined()
	})

	test('preserves valid stopSignal', () => {
		for (const sig of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
			const config = validateConfig({
				processes: {
					web: { command: 'echo hi', stopSignal: sig }
				}
			})
			expect(config.processes.web.stopSignal).toBe(sig)
		}
	})

	test('ignores invalid stopSignal', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', stopSignal: 'SIGKILL' }
			}
		})
		expect(config.processes.web.stopSignal).toBeUndefined()
	})

	test('preserves envFile string', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', envFile: '.env' }
			}
		})
		expect(config.processes.web.envFile).toBe('.env')
	})

	test('preserves envFile array', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', envFile: ['.env', '.env.local'] }
			}
		})
		expect(config.processes.web.envFile).toEqual(['.env', '.env.local'])
	})

	test('ignores invalid envFile', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', envFile: 123 }
			}
		})
		expect(config.processes.web.envFile).toBeUndefined()
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

	test('accepts string shorthand for processes', () => {
		const config = validateConfig({
			processes: {
				web: 'bun dev:web',
				api: 'bun dev:api'
			}
		})
		expect(config.processes.web.command).toBe('bun dev:web')
		expect(config.processes.web.persistent).toBe(true)
		expect(config.processes.api.command).toBe('bun dev:api')
	})

	test('accepts mix of string shorthand and full objects', () => {
		const config = validateConfig({
			processes: {
				db: { command: 'docker compose up postgres', readyPattern: 'ready' },
				web: 'bun dev:web'
			}
		})
		expect(config.processes.db.command).toBe('docker compose up postgres')
		expect(config.processes.db.readyPattern).toBe('ready')
		expect(config.processes.web.command).toBe('bun dev:web')
	})

	test('throws on empty string shorthand', () => {
		expect(() => validateConfig({ processes: { web: '  ' } })).toThrow('non-empty "command" string')
	})

	test('accepts valid hex color', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', color: '#ff8800' }
			}
		})
		expect(config.processes.web.color).toBe('#ff8800')
	})

	test('accepts hex color without hash', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', color: 'ff8800' }
			}
		})
		expect(config.processes.web.color).toBe('ff8800')
	})

	test('throws on invalid hex color', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', color: 'red' }
				}
			})
		).toThrow('valid hex color')
	})

	test('throws on short hex color', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', color: '#fff' }
				}
			})
		).toThrow('valid hex color')
	})

	test('warns when readyPattern is set on non-persistent process', () => {
		const warnings: ValidationWarning[] = []
		const config = validateConfig(
			{
				processes: {
					migrate: { command: 'bun migrate', persistent: false, readyPattern: 'done' }
				}
			},
			warnings
		)
		expect(config.processes.migrate.readyPattern).toBe('done')
		expect(warnings).toHaveLength(1)
		expect(warnings[0].process).toBe('migrate')
		expect(warnings[0].message).toContain('readyPattern is ignored')
	})

	test('no warning when readyPattern is set on persistent process', () => {
		const warnings: ValidationWarning[] = []
		validateConfig(
			{
				processes: {
					web: { command: 'echo hi', readyPattern: 'ready' }
				}
			},
			warnings
		)
		expect(warnings).toHaveLength(0)
	})

	test('throws on non-string env values', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', env: { PORT: 3000 } }
				}
			})
		).toThrow('env.PORT must be a string, got number')
	})

	test('accepts valid string env values', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', env: { PORT: '3000', HOST: 'localhost' } }
			}
		})
		expect(config.processes.web.env).toEqual({ PORT: '3000', HOST: 'localhost' })
	})

	test('no warning when warnings array is not provided', () => {
		// Should not throw when warnings param is omitted
		const config = validateConfig({
			processes: {
				migrate: { command: 'bun migrate', persistent: false, readyPattern: 'done' }
			}
		})
		expect(config.processes.migrate.readyPattern).toBe('done')
	})
})
