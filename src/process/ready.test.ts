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
