import { describe, expect, test } from 'bun:test'
import { shellArgv, shellSpawnOptions } from './shell'

describe('shellArgv', () => {
	test('uses sh on POSIX', () => {
		expect(shellArgv('echo hi', 'darwin')).toEqual(['sh', '-c', 'echo hi'])
		expect(shellArgv('echo hi', 'linux')).toEqual(['sh', '-c', 'echo hi'])
	})

	test('uses cmd with a wrapped tail on Windows', () => {
		// One outer pair of quotes (Node.js exec style) so cmd strips exactly
		// those and parses the inner command, quotes included.
		expect(shellArgv('echo hi', 'win32')).toEqual(['cmd', '/d', '/s', '/c', '"echo hi"'])
		expect(shellArgv('bun -e "process.exit(42)"', 'win32')).toEqual([
			'cmd',
			'/d',
			'/s',
			'/c',
			'"bun -e "process.exit(42)""'
		])
	})

	test('defaults to the current platform', () => {
		const argv = shellArgv('echo hi')
		if (process.platform === 'win32') {
			expect(argv[0]).toBe('cmd')
		} else {
			expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
		}
		expect(argv[argv.length - 1]).toContain('echo hi')
	})
})

describe('shellSpawnOptions', () => {
	test('passes argv verbatim on Windows', () => {
		expect(shellSpawnOptions('win32')).toEqual({ windowsVerbatimArguments: true })
	})

	test('adds no options on POSIX', () => {
		expect(shellSpawnOptions('darwin')).toEqual({})
		expect(shellSpawnOptions('linux')).toEqual({})
	})
})
