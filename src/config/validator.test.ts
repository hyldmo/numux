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

	test('preserves condition string', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', condition: 'CI' }
			}
		})
		expect(config.processes.web.condition).toBe('CI')
	})

	test('preserves negated condition', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', condition: '!CI' }
			}
		})
		expect(config.processes.web.condition).toBe('!CI')
	})

	test('ignores empty condition', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', condition: '' }
			}
		})
		expect(config.processes.web.condition).toBeUndefined()
	})

	test('ignores non-string condition', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', condition: 123 }
			}
		})
		expect(config.processes.web.condition).toBeUndefined()
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

	test('envFile false disables env file loading', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', envFile: false }
			}
		})
		expect(config.processes.web.envFile).toBe(false)
	})

	test('envFile false overrides global envFile', () => {
		const config = validateConfig({
			envFile: '.env',
			processes: {
				a: { command: 'echo a' },
				b: { command: 'echo b', envFile: false }
			}
		})
		expect(config.processes.a.envFile).toBe('.env')
		expect(config.processes.b.envFile).toBe(false)
	})

	test('normalizes string dependsOn to array', () => {
		const config = validateConfig({
			processes: {
				db: { command: 'echo db' },
				web: { command: 'echo hi', dependsOn: 'db' as any }
			}
		})
		expect(config.processes.web.dependsOn).toEqual(['db'])
	})

	test('throws on non-string non-array dependsOn', () => {
		expect(() =>
			validateConfig({
				processes: {
					db: { command: 'echo db' },
					web: { command: 'echo hi', dependsOn: 123 as any }
				}
			})
		).toThrow('dependsOn must be a string or array')
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

	test('accepts basic color names', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', color: 'red' }
			}
		})
		expect(config.processes.web.color).toBe('red')
	})

	test('throws on invalid color', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', color: 'indigo' }
				}
			})
		).toThrow('basic name')
	})

	test('throws on short hex color', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', color: '#fff' }
				}
			})
		).toThrow('basic name')
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

	test('preserves watch string', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', watch: 'src/**/*.ts' }
			}
		})
		expect(config.processes.web.watch).toBe('src/**/*.ts')
	})

	test('preserves watch array', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', watch: ['src/**/*.ts', 'src/**/*.css'] }
			}
		})
		expect(config.processes.web.watch).toEqual(['src/**/*.ts', 'src/**/*.css'])
	})

	test('ignores invalid watch value', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', watch: 123 }
			}
		})
		expect(config.processes.web.watch).toBeUndefined()
	})

	test('ignores watch array with non-string elements', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', watch: ['src/**/*.ts', 123] }
			}
		})
		expect(config.processes.web.watch).toBeUndefined()
	})

	test('interactive defaults to false', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi' }
			}
		})
		expect(config.processes.web.interactive).toBe(false)
	})

	test('preserves interactive: true', () => {
		const config = validateConfig({
			processes: {
				shell: { command: 'bash', interactive: true }
			}
		})
		expect(config.processes.shell.interactive).toBe(true)
	})

	test('interactive defaults to false for string shorthand', () => {
		const config = validateConfig({
			processes: {
				web: 'bun dev'
			}
		})
		expect(config.processes.web.interactive).toBe(false)
	})

	test('preserves errorMatcher: true', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', errorMatcher: true }
			}
		})
		expect(config.processes.web.errorMatcher).toBe(true)
	})

	test('preserves errorMatcher regex string', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', errorMatcher: 'ERROR:' }
			}
		})
		expect(config.processes.web.errorMatcher).toBe('ERROR:')
	})

	test('errorMatcher: false treated as undefined', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', errorMatcher: false }
			}
		})
		expect(config.processes.web.errorMatcher).toBeUndefined()
	})

	test('throws on invalid errorMatcher type', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', errorMatcher: 42 }
				}
			})
		).toThrow('errorMatcher must be true or a regex string')
	})

	test('throws on invalid errorMatcher regex', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', errorMatcher: '[invalid' }
				}
			})
		).toThrow('not a valid regex')
	})

	test('throws on invalid readyPattern regex', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', readyPattern: '[invalid' }
				}
			})
		).toThrow('not a valid regex')
	})

	test('accepts readyPattern with capture groups', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', readyPattern: 'port (?<port>\\d+)' }
			}
		})
		expect(config.processes.web.readyPattern).toBe('port (?<port>\\d+)')
	})

	test('accepts RegExp literal as readyPattern', () => {
		const pattern = /listening at (?<url>http:\/\/\S+)/
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', readyPattern: pattern }
			}
		})
		expect(config.processes.web.readyPattern).toBe(pattern)
	})

	test('preserves valid platform string', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', platform: 'darwin' }
			}
		})
		expect(config.processes.web.platform).toBe('darwin')
	})

	test('preserves valid platform array', () => {
		const config = validateConfig({
			processes: {
				web: { command: 'echo hi', platform: ['darwin', 'linux'] }
			}
		})
		expect(config.processes.web.platform).toEqual(['darwin', 'linux'])
	})

	test('throws on invalid platform string', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', platform: 'macos' }
				}
			})
		).toThrow('not valid')
	})

	test('throws on invalid entry in platform array', () => {
		expect(() =>
			validateConfig({
				processes: {
					web: { command: 'echo hi', platform: ['darwin', 'macos'] }
				}
			})
		).toThrow('not valid')
	})
})

describe('validateConfig — global options', () => {
	test('global cwd is inherited by all processes', () => {
		const config = validateConfig({
			cwd: '/tmp/project',
			processes: {
				a: { command: 'echo a' },
				b: 'echo b'
			}
		})
		expect(config.processes.a.cwd).toBe('/tmp/project')
		expect(config.processes.b.cwd).toBe('/tmp/project')
	})

	test('process cwd overrides global cwd', () => {
		const config = validateConfig({
			cwd: '/tmp/project',
			processes: {
				a: { command: 'echo a', cwd: '/tmp/other' },
				b: { command: 'echo b' }
			}
		})
		expect(config.processes.a.cwd).toBe('/tmp/other')
		expect(config.processes.b.cwd).toBe('/tmp/project')
	})

	test('global env is merged into all processes', () => {
		const config = validateConfig({
			env: { NODE_ENV: 'development', DEBUG: '1' },
			processes: {
				a: { command: 'echo a' },
				b: 'echo b'
			}
		})
		expect(config.processes.a.env).toEqual({ NODE_ENV: 'development', DEBUG: '1' })
		expect(config.processes.b.env).toEqual({ NODE_ENV: 'development', DEBUG: '1' })
	})

	test('process env overrides global env per key', () => {
		const config = validateConfig({
			env: { NODE_ENV: 'development', DEBUG: '1' },
			processes: {
				a: { command: 'echo a', env: { NODE_ENV: 'production', PORT: '3000' } }
			}
		})
		expect(config.processes.a.env).toEqual({ NODE_ENV: 'production', DEBUG: '1', PORT: '3000' })
	})

	test('global envFile is inherited by processes without envFile', () => {
		const config = validateConfig({
			envFile: '.env',
			processes: {
				a: { command: 'echo a' },
				b: { command: 'echo b', envFile: '.env.local' }
			}
		})
		expect(config.processes.a.envFile).toBe('.env')
		expect(config.processes.b.envFile).toBe('.env.local')
	})

	test('global envFile array is inherited', () => {
		const config = validateConfig({
			envFile: ['.env', '.env.shared'],
			processes: {
				a: { command: 'echo a' }
			}
		})
		expect(config.processes.a.envFile).toEqual(['.env', '.env.shared'])
	})

	test('throws on non-string global env values', () => {
		expect(() =>
			validateConfig({
				env: { PORT: 3000 },
				processes: { a: { command: 'echo a' } }
			})
		).toThrow('env.PORT must be a string, got number')
	})

	test('global options are optional', () => {
		const config = validateConfig({
			processes: { a: { command: 'echo a' } }
		})
		expect(config.processes.a.cwd).toBeUndefined()
		expect(config.processes.a.env).toBeUndefined()
		expect(config.processes.a.envFile).toBeUndefined()
	})

	test('showCommand defaults to true', () => {
		const config = validateConfig({
			processes: { a: { command: 'echo a' } }
		})
		expect(config.processes.a.showCommand).toBe(true)
	})

	test('global showCommand: false is inherited', () => {
		const config = validateConfig({
			showCommand: false,
			processes: {
				a: { command: 'echo a' },
				b: 'echo b'
			}
		})
		expect(config.processes.a.showCommand).toBe(false)
		expect(config.processes.b.showCommand).toBe(false)
	})

	test('process showCommand overrides global showCommand', () => {
		const config = validateConfig({
			showCommand: false,
			processes: {
				a: { command: 'echo a', showCommand: true },
				b: { command: 'echo b' }
			}
		})
		expect(config.processes.a.showCommand).toBe(true)
		expect(config.processes.b.showCommand).toBe(false)
	})
})
