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

	test('does not reset at 11MB (OOM backstop is much higher)', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('line1\nline2\n'))
		expect(pane.lineTimestamps.length).toBe(3)
		// The old 10MB cap would reset here. New cap is 500MB so we keep history.
		const bigChunk = encoder.encode('x'.repeat(11 * 1024 * 1024))
		pane.feed(bigChunk)
		// Still 3 (no newlines in the big chunk, no reset)
		expect(pane.lineTimestamps.length).toBe(3)
	})

	test('timestamps are monotonically non-decreasing', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('a\nb\nc\n'))
		for (let i = 1; i < pane.lineTimestamps.length; i++) {
			expect(pane.lineTimestamps[i]).toBeGreaterThanOrEqual(pane.lineTimestamps[i - 1])
		}
	})
})

describe('Pane scrollback retention (Phase 1: tail-render)', () => {
	test('retains line history past the old 50k cap', async () => {
		const pane = await createPane()
		// Old code reset at 50k lines. Verify we now keep going.
		const lines = `${new Array(60_000).fill('log').join('\n')}\n`
		pane.feed(encoder.encode(lines))
		// 1 (initial) + 60_000 newlines = 60_001
		expect(pane.lineTimestamps.length).toBe(60_001)
	})

	test('feed stays fast on a 100k-line burst', async () => {
		const pane = await createPane()
		const chunk = encoder.encode(`${'line\n'.repeat(10_000)}`)
		const start = performance.now()
		for (let i = 0; i < 10; i++) pane.feed(chunk)
		const elapsed = performance.now() - start
		// Generous budget: 10× 10k feeds = 100k lines. Should be well under a second.
		// Older code with reset + full re-serialization would be much slower.
		expect(elapsed).toBeLessThan(2000)
		expect(pane.lineTimestamps.length).toBe(100_001)
	})

	test('feed stays fast on a chunky 100k-line burst with timestamps on', async () => {
		// Regression: pre-fix, the sign-map was rebuilt O(n) on every feed,
		// turning this into ~28s of cumulative work.
		const pane = await createPane({ timestamps: true })
		const chunk = encoder.encode('x\n'.repeat(100))
		const start = performance.now()
		for (let i = 0; i < 1000; i++) pane.feed(chunk)
		const elapsed = performance.now() - start
		// Sign updates are debounced — the feed loop itself must stay fast.
		expect(elapsed).toBeLessThan(500)
		expect(pane.lineTimestamps.length).toBe(100_001)
	})

	test('tail-render returns newest lines, not oldest', async () => {
		const pane = await createPane()
		const lines: string[] = []
		for (let i = 0; i < 20_000; i++) lines.push(`line-${i}`)
		pane.feed(encoder.encode(`${lines.join('\n')}\n`))

		// Access the patched persistent terminal directly. This is the same call
		// the render path makes each frame — verifies tail-offset injection.
		type Pt = {
			getJson: (opts: { limit?: number; offset?: number }) => {
				totalLines: number
				lines: { spans: { text: string }[] }[]
			}
		}
		const pt = (pane.terminal as unknown as { _persistentTerminal: Pt })._persistentTerminal
		const data = pt.getJson({ limit: 5000 })
		const rendered = data.lines.map(l => l.spans.map(s => s.text).join('')).join('\n')
		expect(rendered).toContain('line-19999')
		// Oldest lines must not be in the rendered tail window.
		expect(rendered).not.toContain('line-0\n')
		expect(rendered).not.toContain('line-100\n')
	})

	test('clear() still resets buffer and timestamps', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('a\nb\nc\n'))
		expect(pane.lineTimestamps.length).toBe(4)
		pane.clear()
		expect(pane.lineTimestamps.length).toBe(0)
		expect(pane.terminal.getText()).toBe('')
	})

	test('tail-render includes all lines when totalLines < limit', async () => {
		const pane = await createPane()
		const lines: string[] = []
		for (let i = 0; i < 100; i++) lines.push(`line-${i}`)
		pane.feed(encoder.encode(`${lines.join('\n')}\n`))
		type Pt = {
			getJson: (opts: { limit?: number; offset?: number }) => {
				totalLines: number
				lines: { spans: { text: string }[] }[]
			}
		}
		const pt = (pane.terminal as unknown as { _persistentTerminal: Pt })._persistentTerminal
		const data = pt.getJson({ limit: 5000 })
		const rendered = data.lines.map(l => l.spans.map(s => s.text).join('')).join('\n')
		// Buffer has fewer lines than limit — all must be in the rendered output.
		expect(rendered).toContain('line-0')
		expect(rendered).toContain('line-99')
	})

	test('getJson without limit is not tail-shifted', async () => {
		const pane = await createPane()
		const lines: string[] = []
		for (let i = 0; i < 100; i++) lines.push(`line-${i}`)
		pane.feed(encoder.encode(`${lines.join('\n')}\n`))
		type Pt = {
			getJson: (opts: { limit?: number; offset?: number }) => {
				totalLines: number
				lines: { spans: { text: string }[] }[]
			}
		}
		const pt = (pane.terminal as unknown as { _persistentTerminal: Pt })._persistentTerminal
		// No limit passed — patch must be a no-op (falls through to original getJson).
		const data = pt.getJson({})
		expect(data.totalLines).toBeGreaterThanOrEqual(100)
		const rendered = data.lines.map(l => l.spans.map(s => s.text).join('')).join('\n')
		expect(rendered).toContain('line-0')
		expect(rendered).toContain('line-99')
	})

	test('explicit offset bypasses tail injection', async () => {
		const pane = await createPane()
		const lines: string[] = []
		for (let i = 0; i < 10_000; i++) lines.push(`line-${i}`)
		pane.feed(encoder.encode(`${lines.join('\n')}\n`))
		type Pt = {
			getJson: (opts: { limit?: number; offset?: number }) => {
				totalLines: number
				lines: { spans: { text: string }[] }[]
			}
		}
		const pt = (pane.terminal as unknown as { _persistentTerminal: Pt })._persistentTerminal
		// Caller supplied its own offset — tail injection must not override.
		const data = pt.getJson({ offset: 0, limit: 50 })
		const rendered = data.lines.map(l => l.spans.map(s => s.text).join('')).join('\n')
		expect(rendered).toContain('line-0')
		expect(rendered).not.toContain('line-9999')
	})

	test('destroy does not throw after feed', async () => {
		const pane = await createPane()
		pane.feed(encoder.encode('hello\n'))
		expect(() => pane.destroy()).not.toThrow()
	})

	test('hidden→visible transition stays fast with a 100k-line buffer', async () => {
		// Regression: pre-fix (RENDER_LIMIT=5000), this took ~340ms — the
		// hidden→visible setStyledText call is super-linear in RENDER_LIMIT.
		const { renderer, renderOnce } = await createTestRenderer({ width: 100, height: 30 })
		const a = new Pane(renderer, 'a', 100, 28)
		const b = new Pane(renderer, 'b', 100, 28)
		renderer.root.add(a.scrollBox)
		renderer.root.add(b.scrollBox)
		const chunk = encoder.encode('sample log line that is somewhat realistic in length\n')
		for (let i = 0; i < 100_000; i++) b.feed(chunk)
		b.hide()
		await renderOnce()

		const start = performance.now()
		a.hide()
		b.show()
		await renderOnce()
		const elapsed = performance.now() - start
		// Generous budget: target is ~32ms with RENDER_LIMIT=1500; alarm if we
		// regress to anywhere near the old 340ms cost.
		expect(elapsed).toBeLessThan(150)
		a.destroy()
		b.destroy()
	})

	test('resize does not break tail rendering', async () => {
		const pane = await createPane()
		const lines: string[] = []
		for (let i = 0; i < 10_000; i++) lines.push(`line-${i}`)
		pane.feed(encoder.encode(`${lines.join('\n')}\n`))
		pane.resize(100, 30)
		pane.feed(encoder.encode('after-resize\n'))
		type Pt = {
			getJson: (opts: { limit?: number; offset?: number }) => {
				totalLines: number
				lines: { spans: { text: string }[] }[]
			}
		}
		const pt = (pane.terminal as unknown as { _persistentTerminal: Pt })._persistentTerminal
		const data = pt.getJson({ limit: 5000 })
		const rendered = data.lines.map(l => l.spans.map(s => s.text).join('')).join('\n')
		expect(rendered).toContain('after-resize')
	})

	test('OOM backstop resets buffer at MAX_SCROLLBACK_LINES threshold', async () => {
		const pane = await createPane()
		// Feed in 250k-line chunks. Threshold is 1M, so feed 5 times: the 5th
		// chunk sees lineCounter = 1_000_001 > MAX and triggers a reset before
		// its own content is counted. After reset, that chunk still counts
		// normally — 1 initial + 250k newlines = 250_001 timestamps.
		const chunk = encoder.encode('x\n'.repeat(250_000))
		for (let i = 0; i < 5; i++) pane.feed(chunk)
		// Without reset we would see 1_250_001 timestamps. With reset we see
		// only the last chunk's contribution.
		expect(pane.lineTimestamps.length).toBe(250_001)
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
	// Sign updates are debounced; wait longer than the debounce window before reading.
	const waitForSigns = () => Bun.sleep(60)

	test('every logical line gets a timestamp sign', async () => {
		const pane = await createPane({ timestamps: true })
		pane.feed(encoder.encode('line1\nline2\nline3\n'))
		await waitForSigns()
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
		await waitForSigns()
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
		await waitForSigns()
		const signs = pane.getTimestampSigns()!
		const ts = signs.get(0)!.before!
		// Default format is HH:mm:ss.SSS — 12 chars
		expect(ts).toMatch(/^\d{2}:\d{2}:\d{2}\.\d{3}$/)
	})

	test('signs cleared after clear()', async () => {
		const pane = await createPane({ timestamps: true })
		pane.feed(encoder.encode('line1\nline2\n'))
		await waitForSigns()
		expect(pane.getTimestampSigns()!.size).toBeGreaterThan(0)
		pane.clear()
		expect(pane.getTimestampSigns()!.size).toBe(0)
	})

	test('returns null when timestamps disabled', async () => {
		const pane = await createPane()
		expect(pane.getTimestampSigns()).toBeNull()
	})
})
