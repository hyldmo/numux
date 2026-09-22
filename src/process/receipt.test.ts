import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
	formatReapReport,
	RECEIPT_VERSION,
	ReceiptStore,
	type RunReceipt,
	readProcessStart,
	reapOrphans,
	receiptDir,
	receiptKey
} from './receipt'

let dir: string
let oldReceiptDir: string | undefined

function receiptFile(name: string): string {
	return join(dir, name)
}

function writeReceipt(path: string, receipt: RunReceipt): void {
	writeFileSync(path, JSON.stringify(receipt))
}

/** A pid that has already exited — its identity can never match a real process */
async function deadPid(): Promise<number> {
	const proc = Bun.spawn(['true'], { stdout: 'ignore', stderr: 'ignore' })
	const pid = proc.pid
	await proc.exited
	return pid
}

function staleOwner(pid: number): { pid: number; startTime: string } {
	return { pid, startTime: 'test-stale-owner-identity' }
}

beforeEach(() => {
	dir = join(tmpdir(), `numux-receipt-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(dir, { recursive: true })
	oldReceiptDir = process.env.NUMUX_RECEIPT_DIR
	process.env.NUMUX_RECEIPT_DIR = dir
})

afterEach(() => {
	if (oldReceiptDir === undefined) delete process.env.NUMUX_RECEIPT_DIR
	else process.env.NUMUX_RECEIPT_DIR = oldReceiptDir
	rmSync(dir, { recursive: true, force: true })
})

describe('receipt identity', () => {
	test('readProcessStart returns a stable identity for a live process', () => {
		const first = readProcessStart(process.pid)
		const second = readProcessStart(process.pid)
		expect(first).not.toBeNull()
		expect(second).toBe(first)
	})

	test('readProcessStart returns null for a dead pid', async () => {
		expect(readProcessStart(await deadPid())).toBeNull()
	})
})

describe('reapOrphans — live owner', () => {
	test('leaves everything alone when the owner is still alive', async () => {
		const ownerPid = process.pid
		const ownerStart = readProcessStart(ownerPid)!
		const path = receiptFile('live.json')
		writeReceipt(path, {
			version: RECEIPT_VERSION,
			owner: { pid: ownerPid, startTime: ownerStart },
			processes: [{ name: 'other', pid: ownerPid, pgid: ownerPid, startTime: ownerStart }],
			updatedAt: new Date().toISOString()
		})

		let signals = 0
		const report = await reapOrphans(path, {
			signalGroup: () => {
				signals++
			}
		})

		expect(report.action).toBe('live')
		expect(report.reaped).toHaveLength(0)
		expect(signals).toBe(0)
		expect(existsSync(path)).toBe(true)
	})

	test('does nothing without a receipt file', async () => {
		const report = await reapOrphans(receiptFile('missing.json'))
		expect(report.action).toBe('none')
	})
})

describe('reapOrphans — stale receipt', () => {
	test('reaps a real spawned process whose identity matches', async () => {
		// Pty spawn calls setsid, the same path numux itself uses — so the
		// child leads its own group and signalling -pgid is safe for this test.
		const proc = Bun.spawn(['sleep', '60'], {
			stdout: 'ignore',
			stderr: 'ignore',
			terminal: { cols: 80, rows: 24, data: () => undefined }
		})
		try {
			const startTime = readProcessStart(proc.pid)
			expect(startTime).not.toBeNull()
			const path = receiptFile('stale.json')
			writeReceipt(path, {
				version: RECEIPT_VERSION,
				owner: staleOwner(await deadPid()),
				processes: [{ name: 'sleeper', pid: proc.pid, pgid: proc.pid, startTime: startTime! }],
				updatedAt: new Date().toISOString()
			})

			const report = await reapOrphans(path, { termWaitMs: 2000 })

			expect(report.action).toBe('reaped')
			expect(report.reaped).toEqual(['sleeper'])
			expect(existsSync(path)).toBe(false)
			expect(() => process.kill(proc.pid, 0)).toThrow()
			expect(formatReapReport(report)).toContain('sleeper')
		} finally {
			try {
				process.kill(proc.pid, 'SIGKILL')
			} catch {
				// Already reaped — the expected outcome
			}
			await proc.exited
		}
	}, 10000)

	test('never signals a pid whose identity no longer matches (pid reuse)', async () => {
		const path = receiptFile('reused.json')
		writeReceipt(path, {
			version: RECEIPT_VERSION,
			owner: staleOwner(await deadPid()),
			// Our own pid with a wrong identity: simulates a stranger reusing the pid
			processes: [{ name: 'stranger', pid: process.pid, pgid: process.pid, startTime: 'test-reused-identity' }],
			updatedAt: new Date().toISOString()
		})

		let signals = 0
		let livenessChecks = 0
		const report = await reapOrphans(path, {
			signalGroup: () => {
				signals++
			},
			groupAlive: () => {
				livenessChecks++
				return false
			}
		})

		expect(report.action).toBe('reaped')
		expect(report.reaped).toHaveLength(0)
		expect(report.skipped).toEqual(['stranger'])
		expect(signals).toBe(0)
		expect(livenessChecks).toBe(0)
		expect(existsSync(path)).toBe(false)
		// The "stranger" (this test process) is untouched
		expect(() => process.kill(process.pid, 0)).not.toThrow()
	})

	test('skips Windows with no signalling', async () => {
		const path = receiptFile('win.json')
		writeReceipt(path, {
			version: RECEIPT_VERSION,
			owner: staleOwner(1),
			processes: [],
			updatedAt: new Date().toISOString()
		})
		const report = await reapOrphans(path, { platform: 'win32' })
		expect(report.action).toBe('windows-skipped')
		expect(existsSync(path)).toBe(true)
	})
})

describe('ReceiptStore', () => {
	test('sync writes owner and live processes, clear removes the receipt', () => {
		const path = receiptFile('run.json')
		const store = new ReceiptStore(path)
		store.sync([{ name: 'self', pid: process.pid, pgid: process.pid }])

		const stored = JSON.parse(readFileSync(path, 'utf-8')) as RunReceipt
		expect(stored.version).toBe(RECEIPT_VERSION)
		expect(stored.owner.pid).toBe(process.pid)
		expect(stored.owner.startTime).toBe(readProcessStart(process.pid)!)
		expect(stored.processes).toHaveLength(1)
		expect(stored.processes[0]!.name).toBe('self')

		store.clear()
		expect(existsSync(path)).toBe(false)
	})

	test('empty sync removes the receipt', () => {
		const path = receiptFile('run.json')
		const store = new ReceiptStore(path)
		store.sync([{ name: 'self', pid: process.pid, pgid: process.pid }])
		expect(existsSync(path)).toBe(true)
		store.sync([])
		expect(existsSync(path)).toBe(false)
	})

	test('omits processes that already exited', async () => {
		const path = receiptFile('run.json')
		const store = new ReceiptStore(path)
		store.sync([
			{ name: 'self', pid: process.pid, pgid: process.pid },
			{ name: 'gone', pid: await deadPid(), pgid: 1 }
		])
		const stored = JSON.parse(readFileSync(path, 'utf-8')) as RunReceipt
		expect(stored.processes.map(p => p.name)).toEqual(['self'])
	})
})

describe('receipt paths', () => {
	test('receiptDir honors NUMUX_RECEIPT_DIR', () => {
		expect(receiptDir()).toBe(dir)
	})

	test('receiptKey is stable and separates runs', () => {
		expect(receiptKey('/proj/numux.config.ts', '/proj')).toBe(receiptKey('/proj/numux.config.ts', '/proj'))
		expect(receiptKey('/proj/numux.config.ts', '/proj')).not.toBe(receiptKey('/other/numux.config.ts', '/proj'))
		expect(receiptKey('/proj/numux.config.ts', '/proj')).not.toBe(receiptKey('/proj/numux.config.ts', '/other'))
	})
})
