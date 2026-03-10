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

// Blocked on ghostty-opentui getText() unwrap fix:
// https://github.com/remorses/ghostty-opentui/pull/13
describe('Pane getText()', () => {
	test.todo('getText returns original text without UI line wrapping', async () => {
		// Create a narrow 40-col pane so a long line must visually wrap
		const { renderer } = await createTestRenderer({ width: 40, height: 24 })
		const pane = new Pane(renderer, 'test', 40, 24)
		const longLine = 'A'.repeat(120) // 3x the terminal width
		pane.feed(encoder.encode(`${longLine}\n`))
		const text = pane.getText()
		const lines = text.split('\n').filter(Boolean)
		// Should be a single logical line, not broken into 3 visual lines
		expect(lines.length).toBe(1)
		expect(lines[0]).toBe(longLine)
	})

	test.todo('getText preserves real newlines but not soft wraps', async () => {
		const { renderer } = await createTestRenderer({ width: 40, height: 24 })
		const pane = new Pane(renderer, 'test', 40, 24)
		const line1 = 'B'.repeat(80) // wraps visually
		const line2 = 'C'.repeat(80) // wraps visually
		pane.feed(encoder.encode(`${line1}\n${line2}\n`))
		const text = pane.getText()
		const lines = text.split('\n').filter(Boolean)
		// Should be exactly 2 logical lines despite visual wrapping
		expect(lines.length).toBe(2)
		expect(lines[0]).toBe(line1)
		expect(lines[1]).toBe(line2)
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
