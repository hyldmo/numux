import { describe, expect, test } from 'bun:test'
import { HEX_COLOR_RE, hexToAnsi } from './color'

describe('hexToAnsi', () => {
	test('converts #rrggbb to ANSI true-color sequence', () => {
		expect(hexToAnsi('#ff8800')).toBe('\x1b[38;2;255;136;0m')
	})

	test('converts without leading #', () => {
		expect(hexToAnsi('ff8800')).toBe('\x1b[38;2;255;136;0m')
	})

	test('converts black', () => {
		expect(hexToAnsi('#000000')).toBe('\x1b[38;2;0;0;0m')
	})

	test('converts white', () => {
		expect(hexToAnsi('#ffffff')).toBe('\x1b[38;2;255;255;255m')
	})

	test('returns empty string for malformed hex', () => {
		expect(hexToAnsi('zzzzzz')).toBe('')
		expect(hexToAnsi('#gggggg')).toBe('')
		expect(hexToAnsi('')).toBe('')
	})
})

describe('HEX_COLOR_RE', () => {
	test('matches 6-digit hex with #', () => {
		expect(HEX_COLOR_RE.test('#ff8800')).toBe(true)
		expect(HEX_COLOR_RE.test('#000000')).toBe(true)
		expect(HEX_COLOR_RE.test('#FFFFFF')).toBe(true)
		expect(HEX_COLOR_RE.test('#aAbBcC')).toBe(true)
	})

	test('matches 6-digit hex without #', () => {
		expect(HEX_COLOR_RE.test('ff8800')).toBe(true)
	})

	test('rejects invalid formats', () => {
		expect(HEX_COLOR_RE.test('#fff')).toBe(false)
		expect(HEX_COLOR_RE.test('#gggggg')).toBe(false)
		expect(HEX_COLOR_RE.test('#ff88001')).toBe(false)
		expect(HEX_COLOR_RE.test('')).toBe(false)
	})
})
