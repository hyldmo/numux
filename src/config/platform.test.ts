import { describe, expect, test } from 'bun:test'
import { filterByPlatform } from './platform'

describe('filterByPlatform', () => {
	test('no platform field — all kept', () => {
		const config = {
			processes: {
				web: { command: 'echo web', interactive: false, showCommand: true },
				api: { command: 'echo api', interactive: false, showCommand: true }
			}
		}
		const result = filterByPlatform(config, 'darwin')
		expect(Object.keys(result.processes)).toEqual(['web', 'api'])
	})

	test('matching single string — kept', () => {
		const config = {
			processes: {
				web: {
					command: 'echo web',
					interactive: false,
					showCommand: true,
					platform: 'darwin'
				}
			}
		}
		const result = filterByPlatform(config, 'darwin')
		expect(result.processes.web).toBeDefined()
	})

	test('non-matching string — removed', () => {
		const config = {
			processes: {
				web: { command: 'echo web', interactive: false, showCommand: true, platform: 'win32' }
			}
		}
		const result = filterByPlatform(config, 'darwin')
		expect(result.processes.web).toBeUndefined()
	})

	test('matching array — kept', () => {
		const config = {
			processes: {
				web: {
					command: 'echo web',
					interactive: false,
					showCommand: true,
					platform: ['darwin', 'linux']
				}
			}
		}
		const result = filterByPlatform(config, 'linux')
		expect(result.processes.web).toBeDefined()
	})

	test('non-matching array — removed', () => {
		const config = {
			processes: {
				web: {
					command: 'echo web',
					interactive: false,
					showCommand: true,
					platform: ['darwin', 'linux']
				}
			}
		}
		const result = filterByPlatform(config, 'win32')
		expect(result.processes.web).toBeUndefined()
	})

	test('dependent dependsOn stripped of removed process', () => {
		const config = {
			processes: {
				db: { command: 'echo db', interactive: false, showCommand: true, platform: 'linux' },
				api: {
					command: 'echo api',
					interactive: false,
					showCommand: true,
					dependsOn: ['db']
				}
			}
		}
		const result = filterByPlatform(config, 'darwin')
		expect(result.processes.db).toBeUndefined()
		expect(result.processes.api).toBeDefined()
		expect(result.processes.api.dependsOn).toBeUndefined()
	})

	test('all deps removed — dependsOn becomes undefined', () => {
		const config = {
			processes: {
				a: { command: 'echo a', interactive: false, showCommand: true, platform: 'linux' },
				b: { command: 'echo b', interactive: false, showCommand: true, platform: 'linux' },
				c: {
					command: 'echo c',
					interactive: false,
					showCommand: true,
					dependsOn: ['a', 'b']
				}
			}
		}
		const result = filterByPlatform(config, 'darwin')
		expect(result.processes.c.dependsOn).toBeUndefined()
	})

	test('all processes excluded — empty processes object', () => {
		const config = {
			processes: {
				web: { command: 'echo web', interactive: false, showCommand: true, platform: 'linux' }
			}
		}
		const result = filterByPlatform(config, 'darwin')
		expect(Object.keys(result.processes)).toEqual([])
	})
})
