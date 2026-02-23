import { describe, expect, test } from 'bun:test'
import { createErrorChecker } from './error'

describe('createErrorChecker', () => {
	test('returns null when no errorMatcher configured', () => {
		expect(createErrorChecker({ command: 'echo hi' })).toBeNull()
	})

	test('returns null when errorMatcher is false', () => {
		expect(createErrorChecker({ command: 'echo hi', errorMatcher: false })).toBeNull()
	})

	describe('boolean mode (ANSI red detection)', () => {
		test('detects SGR 31 (standard red)', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('\x1b[31mError: something failed\x1b[0m')).toBe(true)
		})

		test('detects SGR 91 (bright red)', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('\x1b[91mFatal error\x1b[0m')).toBe(true)
		})

		test('detects red with bold (1;31)', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('\x1b[1;31mBold red\x1b[0m')).toBe(true)
		})

		test('detects red with other params (0;31;42)', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('\x1b[0;31;42mRed on green\x1b[0m')).toBe(true)
		})

		test('does not fire on green (SGR 32)', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('\x1b[32mAll good\x1b[0m')).toBe(false)
		})

		test('does not fire on plain text', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('no colors here')).toBe(false)
		})

		test('does not fire on SGR 131 (not red)', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('\x1b[131m')).toBe(false)
		})
	})

	describe('string mode (regex pattern)', () => {
		test('matches regex against ANSI-stripped text', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: 'ERROR:' })!
			expect(checker.feedOutput('\x1b[31mERROR: something\x1b[0m')).toBe(true)
		})

		test('matches plain text', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: 'FATAL' })!
			expect(checker.feedOutput('FATAL: out of memory')).toBe(true)
		})

		test('does not match when pattern absent', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: 'ERROR' })!
			expect(checker.feedOutput('all good')).toBe(false)
		})

		test('supports regex syntax', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: 'error:\\s+\\w+' })!
			expect(checker.feedOutput('error: timeout')).toBe(true)
		})
	})

	describe('one-shot behavior', () => {
		test('returns false after first trigger', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: true })!
			expect(checker.feedOutput('\x1b[31mfirst error\x1b[0m')).toBe(true)
			expect(checker.feedOutput('\x1b[31msecond error\x1b[0m')).toBe(false)
		})
	})

	describe('accumulation', () => {
		test('accumulates across multiple feeds', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: 'ready to fail' })!
			expect(checker.feedOutput('ready to ')).toBe(false)
			expect(checker.feedOutput('fail now')).toBe(true)
		})

		test('buffer cap prevents unbounded growth', () => {
			const checker = createErrorChecker({ command: 'echo hi', errorMatcher: 'NEEDLE' })!
			const filler = 'x'.repeat(100_000)
			expect(checker.feedOutput(filler)).toBe(false)
			expect(checker.feedOutput('NEEDLE')).toBe(true)
		})
	})
})
