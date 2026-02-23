import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
})
