import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { Pane } from './pane'

const encoder = new TextEncoder()

async function createPane(opts?: { timestamps?: boolean | string }) {
	const { renderer } = await createTestRenderer({ width: 80, height: 24 })
	const pane = new Pane(renderer, 'test', 80, 24)
	if (opts?.timestamps) {
		pane.setTimestamps(opts.timestamps)
	}
	return pane
}

describe('Pane timestamp tracking', () => {
	test('records timestamp for each newline', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('line1\nline2\nline3\n'))
		// line 0 (initial), line 1, line 2, line 3 (after trailing \n)
		expect(pane.lineTimestamps.length).toBe(4)
	})

	test('records timestamp for first feed even without newline', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('hello'))
		expect(pane.lineTimestamps.length).toBe(1)
	})

	test('accumulates timestamps across multiple feeds', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('line1\n'))
		pane.feed(encoder.encode('line2\n'))
		expect(pane.lineTimestamps.length).toBe(3) // initial + 2 newlines
	})

	test('clears timestamps on clear()', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('line1\nline2\n'))
		expect(pane.lineTimestamps.length).toBeGreaterThan(0)
		pane.clear()
		expect(pane.lineTimestamps.length).toBe(0)
	})

	test('resets timestamps on scrollback overflow', async () => {
		const pane = await createPane()
		// Feed some data first
		pane.feed(encoder.encode('line1\nline2\n'))
		expect(pane.lineTimestamps.length).toBe(3)
		// Simulate buffer overflow by feeding >10MB
		const bigChunk = encoder.encode('x'.repeat(11 * 1024 * 1024))
		pane.feed(bigChunk)
		// After reset, should have 1 timestamp (for the current feed's initial line)
		expect(pane.lineTimestamps.length).toBe(1)
	})

	test('timestamps are monotonically non-decreasing', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('a\nb\nc\n'))
		for (let i = 1; i < pane.lineTimestamps.length; i++) {
			expect(pane.lineTimestamps[i]).toBeGreaterThanOrEqual(pane.lineTimestamps[i - 1])
		}
	})
})

describe('Pane timestamp toggle', () => {
	test('setTimestamps enables and disables with boolean', async () => {
		const pane = await createPane()
		expect(pane.timestampsEnabled).toBe(false)
		pane.setTimestamps(true)
		expect(pane.timestampsEnabled).toBe(true)
		pane.setTimestamps(false)
		expect(pane.timestampsEnabled).toBe(false)
	})

	test('setTimestamps accepts a format string', async () => {
		const pane = await createPane()
		pane.setTimestamps('HH:mm:ss.SSS')
		expect(pane.timestampsEnabled).toBe(true)
		pane.setTimestamps(false)
		expect(pane.timestampsEnabled).toBe(false)
	})

	test('setTimestamps is idempotent', async () => {
		const pane = await createPane()
		pane.setTimestamps(true)
		pane.setTimestamps(true) // no-op
		expect(pane.timestampsEnabled).toBe(true)
		pane.setTimestamps(false)
		pane.setTimestamps(false) // no-op
		expect(pane.timestampsEnabled).toBe(false)
	})

	test('timestamps can be enabled from constructor flow', async () => {
		const pane = await createPane({ timestamps: true })
		expect(pane.timestampsEnabled).toBe(true)
		pane.feed(encoder.encode('hello\nworld\n'))
		expect(pane.lineTimestamps.length).toBe(3)
	})

	test('timestamps can be enabled with format from constructor flow', async () => {
		const pane = await createPane({ timestamps: 'HH:mm:ss.SSS' })
		expect(pane.timestampsEnabled).toBe(true)
	})
})

describe('Pane timestamp signs', () => {
	test('every logical line gets a timestamp sign', async () => {
		const pane = await createPane({ timestamps: true })
		pane.feed(encoder.encode('line1\nline2\nline3\n'))
		const signs = pane.getTimestampSigns()!
		// 4 logical lines: line1, line2, line3, and trailing newline
		expect(signs.size).toBe(4)
		for (let i = 0; i < 4; i++) {
			expect(signs.has(i)).toBe(true)
			expect(signs.get(i)!.before).toBeDefined()
		}
	})

	test('lines with identical timestamps still get individual signs', async () => {
		const pane = await createPane({ timestamps: 'HH:mm:ss' })
		// All lines fed in one call — same Date.now() — same formatted second
		pane.feed(encoder.encode('a\nb\nc\n'))
		const signs = pane.getTimestampSigns()!
		expect(signs.size).toBe(4)
		// All should have the same formatted value but still be present
		const values = [...signs.values()].map(s => s.before)
		expect(new Set(values).size).toBe(1) // same second
		expect(values.length).toBe(4) // but every line has one
	})

	test('signs include milliseconds with default format', async () => {
		const pane = await createPane({ timestamps: true })
		pane.feed(encoder.encode('hello\n'))
		const signs = pane.getTimestampSigns()!
		const ts = signs.get(0)!.before!
		// Default format is HH:mm:ss.SSS — 12 chars
		expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)
	})

	test('signs cleared after clear()', async () => {
		const pane = await createPane({ timestamps: true })
		pane.feed(encoder.encode('line1\nline2\n'))
		expect(pane.getTimestampSigns()!.size).toBeGreaterThan(0)
		pane.clear()
		expect(pane.getTimestampSigns()!.size).toBe(0)
	})

	test('returns null when timestamps disabled', async () => {
		const pane = await createPane()
		expect(pane.getTimestampSigns()).toBeNull()
	})
})
