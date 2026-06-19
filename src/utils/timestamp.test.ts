import { describe, expect, test } from 'bun:test'
import { DEFAULT_TIMESTAMP_FORMAT, formatTimestamp, resolveTimestampFormat } from './timestamp'

describe('formatTimestamp', () => {
	// Use a fixed date: 2024-03-15 14:05:09.123
	const date = new Date(2024, 2, 15, 14, 5, 9, 123)

	test('default format HH:mm:ss', () => {
		expect(formatTimestamp(date, 'HH:mm:ss')).toBe('14:05:09')
	})

	test('format with milliseconds', () => {
		expect(formatTimestamp(date, 'HH:mm:ss.SSS')).toBe('14:05:09.123')
	})

	test('12-hour format', () => {
		expect(formatTimestamp(date, 'hh:mm:ss A')).toBe('02:05:09 PM')
	})

	test('date format', () => {
		expect(formatTimestamp(date, 'YYYY-MM-DD')).toBe('2024-03-15')
	})

	test('full datetime', () => {
		expect(formatTimestamp(date, 'YYYY-MM-DD HH:mm:ss')).toBe('2024-03-15 14:05:09')
	})

	test('midnight is 12 in 12-hour format', () => {
		const midnight = new Date(2024, 0, 1, 0, 0, 0)
		expect(formatTimestamp(midnight, 'hh:mm A')).toBe('12:00 AM')
	})

	test('noon is 12 PM', () => {
		const noon = new Date(2024, 0, 1, 12, 0, 0)
		expect(formatTimestamp(noon, 'hh:mm A')).toBe('12:00 PM')
	})
})

describe('resolveTimestampFormat', () => {
	test('returns null for falsy values', () => {
		expect(resolveTimestampFormat(undefined)).toBeNull()
		expect(resolveTimestampFormat(false)).toBeNull()
	})

	test('returns default format for true', () => {
		expect(resolveTimestampFormat(true)).toBe(DEFAULT_TIMESTAMP_FORMAT)
	})

	test('returns custom format string as-is', () => {
		expect(resolveTimestampFormat('HH:mm:ss.SSS')).toBe('HH:mm:ss.SSS')
	})
})
