import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _resetLogger, enableDebugLog, log } from './logger'

let dir: string

beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), 'numux-logger-test-'))
	_resetLogger()
})

afterEach(() => {
	_resetLogger()
	rmSync(dir, { recursive: true, force: true })
})

describe('logger', () => {
	test('log is a no-op when not enabled', () => {
		log('should not appear')
		const logFile = join(dir, 'debug.log')
		expect(existsSync(logFile)).toBe(false)
	})

	test('enableDebugLog creates the directory', () => {
		const logDir = join(dir, 'subdir')
		enableDebugLog(logDir)
		expect(existsSync(logDir)).toBe(true)
	})

	test('log writes to debug.log after enableDebugLog', () => {
		enableDebugLog(dir)
		log('hello world')

		const content = readFileSync(join(dir, 'debug.log'), 'utf-8')
		expect(content).toContain('hello world')
	})

	test('log writes ISO timestamp', () => {
		enableDebugLog(dir)
		log('timestamped')

		const content = readFileSync(join(dir, 'debug.log'), 'utf-8')
		// ISO timestamp format: [2024-01-01T00:00:00.000Z]
		expect(content).toMatch(/^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
	})

	test('log formats extra args as JSON', () => {
		enableDebugLog(dir)
		log('data', { key: 'value' }, 42)

		const content = readFileSync(join(dir, 'debug.log'), 'utf-8')
		expect(content).toContain('data {"key":"value"} 42')
	})

	test('log appends multiple messages', () => {
		enableDebugLog(dir)
		log('first')
		log('second')

		const content = readFileSync(join(dir, 'debug.log'), 'utf-8')
		const lines = content.trim().split('\n')
		expect(lines).toHaveLength(2)
		expect(lines[0]).toContain('first')
		expect(lines[1]).toContain('second')
	})
})
