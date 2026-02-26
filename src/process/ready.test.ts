import { describe, expect, test } from 'bun:test'
import { createReadinessChecker } from './ready'

describe('createReadinessChecker', () => {
	test('persistent + no pattern → immediately ready', () => {
		const checker = createReadinessChecker({ command: 'echo hi', persistent: true })
		expect(checker.isImmediatelyReady).toBe(true)
		expect(checker.dependsOnExit).toBe(false)
	})

	test('persistent + pattern → not immediately ready, needs output match', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: 'listening on port \\d+'
		})
		expect(checker.isImmediatelyReady).toBe(false)
		expect(checker.dependsOnExit).toBe(false)

		expect(checker.feedOutput('Starting server...')).toBe(false)
		expect(checker.feedOutput('listening on port 3000')).toBe(true)
	})

	test('non-persistent → depends on exit, not immediately ready', () => {
		const checker = createReadinessChecker({ command: 'echo hi', persistent: false })
		expect(checker.isImmediatelyReady).toBe(false)
		expect(checker.dependsOnExit).toBe(true)
	})

	test('default persistent (undefined) → treated as persistent', () => {
		const checker = createReadinessChecker({ command: 'echo hi' })
		expect(checker.isImmediatelyReady).toBe(true)
		expect(checker.dependsOnExit).toBe(false)
	})

	test('pattern match accumulates across multiple feeds', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: 'ready to accept'
		})
		expect(checker.feedOutput('ready to ')).toBe(false)
		expect(checker.feedOutput('accept connections')).toBe(true)
	})

	test('non-persistent ignores feedOutput', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: false,
			readyPattern: 'done'
		})
		// Non-persistent processes depend on exit code, not pattern
		expect(checker.feedOutput('done')).toBe(false)
	})

	test('string pattern does not extract captures', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: 'listening at (?<url>http://\\S+)'
		})
		expect(checker.feedOutput('listening at http://localhost:3000')).toBe(true)
		expect(checker.captures).toBeNull()
	})

	test('RegExp extracts named capture groups', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: /listening at (?<url>http:\/\/\S+)/
		})
		expect(checker.captures).toBeNull()
		expect(checker.feedOutput('listening at http://localhost:3000')).toBe(true)
		expect(checker.captures).toEqual({
			url: 'http://localhost:3000',
			'1': 'http://localhost:3000'
		})
	})

	test('RegExp extracts positional capture groups', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: /port (\d+) on (\w+)/
		})
		expect(checker.feedOutput('port 3000 on localhost')).toBe(true)
		expect(checker.captures).toEqual({
			'1': '3000',
			'2': 'localhost'
		})
	})

	test('RegExp without groups returns null captures', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: /ready/
		})
		expect(checker.feedOutput('ready')).toBe(true)
		expect(checker.captures).toBeNull()
	})

	test('RegExp extracts mixed named and positional groups', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: /(?<host>\w+):(\d+)/
		})
		expect(checker.feedOutput('localhost:3000')).toBe(true)
		expect(checker.captures).toEqual({
			host: 'localhost',
			'1': 'localhost',
			'2': '3000'
		})
	})

	test('buffer is capped to prevent unbounded memory growth', () => {
		const checker = createReadinessChecker({
			command: 'echo hi',
			persistent: true,
			readyPattern: 'READY'
		})
		// Feed 100 KB of filler — buffer should be trimmed to ~64 KB
		const filler = 'x'.repeat(100_000)
		expect(checker.feedOutput(filler)).toBe(false)
		// Pattern at the end should still match after trim
		expect(checker.feedOutput('READY')).toBe(true)
	})
})
