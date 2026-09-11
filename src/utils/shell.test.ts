import { describe, expect, test } from 'bun:test'
import { shellArgv } from './shell'

describe('shellArgv', () => {
	test('uses sh on POSIX', () => {
		expect(shellArgv('echo hi', 'darwin')).toEqual(['sh', '-c', 'echo hi'])
		expect(shellArgv('echo hi', 'linux')).toEqual(['sh', '-c', 'echo hi'])
	})

	test('uses cmd on Windows', () => {
		expect(shellArgv('echo hi', 'win32')).toEqual(['cmd', '/d', '/s', '/c', 'echo hi'])
	})

	test('defaults to the current platform', () => {
		const argv = shellArgv('echo hi')
		if (process.platform === 'win32') {
			expect(argv[0]).toBe('cmd')
		} else {
			expect(argv.slice(0, 2)).toEqual(['sh', '-c'])
		}
		expect(argv[argv.length - 1]).toBe('echo hi')
	})
})
