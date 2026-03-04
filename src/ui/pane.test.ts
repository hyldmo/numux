import { describe, expect, test } from 'bun:test'
import { createTestRenderer } from '@opentui/core/testing'
import { Pane } from './pane'

const encoder = new TextEncoder()

async function createPane(opts?: { timestamps?: boolean }) {
	const { renderer } = await createTestRenderer({ width: 80, height: 24 })
	const pane = new Pane(renderer, 'test', 80, 24)
	if (opts?.timestamps) {
		pane.setTimestamps(true)
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
	test('setTimestamps enables and disables', async () => {
		const pane = await createPane()
		expect(pane.timestampsEnabled).toBe(false)
		pane.setTimestamps(true)
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
})
