import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, lstatSync, mkdtempSync, readFileSync, readlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ProcessEvent } from '../types'
import { LogWriter } from './log-writer'

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'numux-log-test-'))
})

afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

function outputEvent(name: string, text: string): ProcessEvent {
	return { type: 'output', name, data: new TextEncoder().encode(text) }
}

describe('LogWriter', () => {
	test('creates log files per process', () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'hello'))
		writer.handleEvent(outputEvent('web', 'world'))
		writer.close()

		expect(existsSync(join(dir, 'api.log'))).toBe(true)
		expect(existsSync(join(dir, 'web.log'))).toBe(true)
	})

	test('writes output to files', () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'line 1\n'))
		writer.handleEvent(outputEvent('api', 'line 2\n'))
		writer.close()

		const content = readFileSync(join(dir, 'api.log'), 'utf-8')
		expect(content).toContain('line 1')
		expect(content).toContain('line 2')
	})

	test('strips ANSI escape sequences', () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', '\x1b[32mgreen\x1b[0m normal'))
		writer.close()

		const content = readFileSync(join(dir, 'api.log'), 'utf-8')
		expect(content).toBe('green normal')
		expect(content).not.toContain('\x1b')
	})

	test('ignores non-output events', () => {
		const writer = new LogWriter(dir)
		writer.handleEvent({ type: 'status', name: 'api', status: 'running' })
		writer.handleEvent({ type: 'exit', name: 'api', code: 0 })
		writer.close()

		expect(existsSync(join(dir, 'api.log'))).toBe(false)
	})

	test('creates directory if it does not exist', () => {
		const nested = join(dir, 'sub', 'logs')
		const writer = new LogWriter(nested)
		writer.handleEvent(outputEvent('api', 'test'))
		writer.close()

		expect(existsSync(join(nested, 'api.log'))).toBe(true)
	})

	test('getLogPath returns path for known process', () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'hello'))

		expect(writer.getLogPath('api')).toBe(join(dir, 'api.log'))
		expect(writer.getLogPath('unknown')).toBeUndefined()
		writer.close()
	})

	test('search finds matches in log file', async () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'hello world\n'))
		writer.handleEvent(outputEvent('api', 'foo bar\n'))
		writer.handleEvent(outputEvent('api', 'hello again\n'))

		const matches = await writer.search('api', 'hello')
		expect(matches.length).toBe(2)
		expect(matches[0]).toEqual({ line: 0, start: 0, end: 5 })
		expect(matches[1]).toEqual({ line: 2, start: 0, end: 5 })
		writer.close()
	})

	test('search is case-insensitive', async () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'Hello World\n'))
		writer.handleEvent(outputEvent('api', 'HELLO again\n'))

		const matches = await writer.search('api', 'hello')
		expect(matches.length).toBe(2)
		writer.close()
	})

	test('search returns empty for unknown process', async () => {
		const writer = new LogWriter(dir)
		const matches = await writer.search('unknown', 'test')
		expect(matches).toEqual([])
		writer.close()
	})

	test('search returns empty for empty query', async () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'hello\n'))
		const matches = await writer.search('api', '')
		expect(matches).toEqual([])
		writer.close()
	})

	test('search finds multiple matches on same line', async () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'foo foo foo\n'))

		const matches = await writer.search('api', 'foo')
		expect(matches.length).toBe(3)
		expect(matches[0]).toEqual({ line: 0, start: 0, end: 3 })
		expect(matches[1]).toEqual({ line: 0, start: 4, end: 7 })
		expect(matches[2]).toEqual({ line: 0, start: 8, end: 11 })
		writer.close()
	})

	test('truncate clears log file', () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'old content\n'))

		const contentBefore = readFileSync(join(dir, 'api.log'), 'utf-8')
		expect(contentBefore).toContain('old content')

		writer.truncate('api')
		writer.handleEvent(outputEvent('api', 'new content\n'))
		writer.close()

		const contentAfter = readFileSync(join(dir, 'api.log'), 'utf-8')
		expect(contentAfter).toBe('new content\n')
		expect(contentAfter).not.toContain('old content')
	})

	test('createTemp creates a temp directory', () => {
		const writer = LogWriter.createTemp()
		writer.handleEvent(outputEvent('api', 'test'))
		const path = writer.getLogPath('api')
		expect(path).toBeDefined()
		expect(existsSync(path!)).toBe(true)
		writer.cleanup()
	})

	test('cleanup removes temp directory', () => {
		const writer = LogWriter.createTemp()
		writer.handleEvent(outputEvent('api', 'test'))
		const path = writer.getLogPath('api')!
		expect(existsSync(path)).toBe(true)

		writer.cleanup()
		expect(existsSync(path)).toBe(false)
	})

	test('cleanup does not remove user-specified directory', () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'test'))
		writer.cleanup()

		// Directory still exists (only files closed, dir not removed)
		expect(existsSync(dir)).toBe(true)
	})

	test('isTemporary returns true for temp writers', () => {
		const writer = LogWriter.createTemp()
		expect(writer.isTemporary).toBe(true)
		writer.cleanup()
	})

	test('isTemporary returns false for user-specified directory', () => {
		const writer = new LogWriter(dir)
		expect(writer.isTemporary).toBe(false)
		writer.close()
	})

	test('getDirectory returns the log directory path', () => {
		const writer = new LogWriter(dir)
		expect(writer.getDirectory()).toBe(dir)
		writer.close()
	})

	test('getProcessNames returns names of processes with output', () => {
		const writer = new LogWriter(dir)
		expect(writer.getProcessNames()).toEqual([])

		writer.handleEvent(outputEvent('api', 'hello'))
		writer.handleEvent(outputEvent('web', 'world'))

		const names = writer.getProcessNames()
		expect(names).toContain('api')
		expect(names).toContain('web')
		expect(names.length).toBe(2)
		writer.close()
	})

	test('searchAll finds matches across multiple processes', async () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'hello world\n'))
		writer.handleEvent(outputEvent('api', 'foo bar\n'))
		writer.handleEvent(outputEvent('web', 'hello again\n'))
		writer.handleEvent(outputEvent('web', 'baz\n'))

		const matches = await writer.searchAll('hello')
		expect(matches.length).toBe(2)

		const apiMatches = matches.filter(m => m.process === 'api')
		const webMatches = matches.filter(m => m.process === 'web')
		expect(apiMatches.length).toBe(1)
		expect(webMatches.length).toBe(1)
		expect(apiMatches[0]).toEqual({ process: 'api', line: 0, start: 0, end: 5 })
		expect(webMatches[0]).toEqual({ process: 'web', line: 0, start: 0, end: 5 })
		writer.close()
	})

	test('searchAll returns empty for empty query', async () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'hello\n'))
		const matches = await writer.searchAll('')
		expect(matches).toEqual([])
		writer.close()
	})

	test('searchAll returns empty when no processes have output', async () => {
		const writer = new LogWriter(dir)
		const matches = await writer.searchAll('hello')
		expect(matches).toEqual([])
		writer.close()
	})

	test('searchAll is case-insensitive', async () => {
		const writer = new LogWriter(dir)
		writer.handleEvent(outputEvent('api', 'Hello World\n'))
		writer.handleEvent(outputEvent('web', 'HELLO again\n'))

		const matches = await writer.searchAll('hello')
		expect(matches.length).toBe(2)
		writer.close()
	})

	test('createPersistent creates timestamped subdirectory', () => {
		const baseDir = join(dir, 'logs')
		const writer = LogWriter.createPersistent(baseDir)

		expect(writer.isTemporary).toBe(false)
		expect(writer.getDirectory()).toContain(baseDir)
		expect(writer.getDirectory()).not.toBe(baseDir)

		// Session dir exists
		expect(existsSync(writer.getDirectory())).toBe(true)

		writer.close()
	})

	test('createPersistent creates latest symlink', () => {
		const baseDir = join(dir, 'logs')
		const writer = LogWriter.createPersistent(baseDir)

		const latestLink = join(baseDir, 'latest')
		expect(existsSync(latestLink)).toBe(true)
		expect(lstatSync(latestLink).isSymbolicLink()).toBe(true)
		expect(readlinkSync(latestLink)).toBe(writer.getDirectory())

		writer.close()
	})

	test('createPersistent does not clean up on cleanup', () => {
		const baseDir = join(dir, 'logs')
		const writer = LogWriter.createPersistent(baseDir)
		writer.handleEvent(outputEvent('api', 'test'))
		const sessionDir = writer.getDirectory()

		writer.cleanup()

		// Session directory should still exist
		expect(existsSync(sessionDir)).toBe(true)
	})
})
