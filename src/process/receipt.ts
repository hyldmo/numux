import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { log } from '../utils/logger'

/**
 * Receipt-based reaping of orphaned process groups.
 *
 * Every managed process is spawned with a pty, which calls `setsid` — so each
 * one leads its own session and process group. The normal SIGINT/SIGTERM path
 * stops those groups via `stop()`, but a SIGKILLed or crashed numux never runs
 * that code and the groups survive with no parent. The next run for the same
 * config would then fight them over ports, locks and UI.
 *
 * While a run is live, a receipt file records the pids it owns plus an
 * identity per pid (process start time) that survives pid reuse. On startup,
 * before starting anything, a stale receipt — one whose numux owner is gone —
 * has its still-matching groups reaped. A pid whose identity no longer matches
 * belongs to a stranger and is never signalled.
 */

export const RECEIPT_VERSION = 1

/** Grace period between SIGTERM and SIGKILL when reaping orphans */
export const REAP_TERM_WAIT_MS = 2000

export interface ReceiptEntry {
	/** Process name from the config */
	name: string
	pid: number
	/** Process group id — equals pid, pty spawns call setsid */
	pgid: number
	/** Process start time; empty when it could not be read */
	startTime: string
}

export interface ReceiptOwner {
	pid: number
	startTime: string
}

export interface RunReceipt {
	version: number
	owner: ReceiptOwner
	processes: ReceiptEntry[]
	updatedAt: string
}

/** Live processes the receipt should track. pgid equals pid (see above). */
export interface TrackedProcess {
	name: string
	pid: number
	pgid: number
}

export interface ReapReport {
	action: 'reaped' | 'live' | 'none' | 'windows-skipped'
	reaped: string[]
	skipped: string[]
}

/** Override point for tests. Matches the real helpers below. */
export interface ReapDeps {
	platform?: NodeJS.Platform
	currentPid?: number
	isAlive?: (pid: number) => boolean
	readStart?: (pid: number) => string | null
	signalGroup?: (pgid: number, signal: NodeJS.Signals) => void
	groupAlive?: (pgid: number) => boolean
	sleep?: (ms: number) => Promise<void>
	termWaitMs?: number
}

/** Where receipts live. Overridable via env for tests. */
export function receiptDir(platform: NodeJS.Platform = process.platform): string {
	const override = process.env.NUMUX_RECEIPT_DIR
	if (override) return override
	const home = homedir()
	if (platform === 'darwin') return join(home, 'Library', 'Caches', 'numux', 'runs')
	if (platform === 'win32') {
		const base = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')
		return join(base, 'numux', 'runs')
	}
	const base = process.env.XDG_CACHE_HOME ?? join(home, '.cache')
	return join(base, 'numux', 'runs')
}

/**
 * Stable key for a run: hash of the resolved config path plus cwd. With no
 * config file (CLI-args mode) the key falls back to the cwd, so any run in
 * the same directory contends for the same receipt.
 */
export function receiptKey(configPath: string | undefined, cwd: string): string {
	const resolved = configPath ? resolve(configPath) : resolve(cwd)
	return createHash('sha256')
		.update(`${resolved}\0${resolve(cwd)}`)
		.digest('hex')
		.slice(0, 16)
}

/** Best-effort resolved config path mirroring the loader's auto-detect, without importing it. */
export function resolveConfigPath(explicitPath: string | undefined, cwd: string): string | undefined {
	if (explicitPath) return resolve(explicitPath)
	for (const file of ['numux.config.ts', 'numux.config.js']) {
		const candidate = resolve(cwd, file)
		if (existsSync(candidate)) return candidate
	}
	const pkg = resolve(cwd, 'package.json')
	if (existsSync(pkg)) {
		try {
			const parsed = JSON.parse(readFileSync(pkg, 'utf-8')) as Record<string, unknown>
			if (parsed.numux && typeof parsed.numux === 'object') return pkg
		} catch {
			// Unreadable package.json — fall through to cwd-only key
		}
	}
	return undefined
}

export function receiptPath(explicitConfigPath: string | undefined, cwd: string): string {
	return join(receiptDir(), `run-${receiptKey(resolveConfigPath(explicitConfigPath, cwd), cwd)}.json`)
}

/** True when a signal can be delivered — EPERM means alive, ESRCH means gone. */
export function isPidAlive(pid: number): boolean {
	try {
		process.kill(pid, 0)
		return true
	} catch (err) {
		// EPERM: process exists but we may not signal it — still alive
		return (err as NodeJS.ErrnoException)?.code !== 'ESRCH'
	}
}

/**
 * Start-time identity for a pid: `/proc/<pid>/stat` field 22 (ticks since
 * boot, qualified with boot time) on Linux, `ps -o lstart=` elsewhere. Null
 * when the pid does not exist or cannot be read.
 */
export function readProcessStart(pid: number, platform: NodeJS.Platform = process.platform): string | null {
	if (platform === 'linux') {
		const fromProc = readLinuxStartTime(pid)
		if (fromProc) return fromProc
	}
	if (platform === 'win32') return null
	return readPsStartTime(pid)
}

function readLinuxStartTime(pid: number): string | null {
	try {
		const stat = readFileSync(`/proc/${pid}/stat`, 'utf-8')
		// comm (field 2) may contain spaces/parens — split after the last ')'
		const after = stat
			.slice(stat.lastIndexOf(')') + 1)
			.trim()
			.split(/\s+/)
		// Fields after comm start at field 3, so starttime (field 22) is index 19
		const ticks = after[19]
		if (!ticks) return null
		let boot = ''
		try {
			const match = /btime (\d+)/.exec(readFileSync('/proc/stat', 'utf-8'))
			if (match) boot = `${match[1]}:`
		} catch {
			// Boot time is a qualifier — ticks alone still identify the process
		}
		return `linux:${boot}${ticks}`
	} catch {
		return null
	}
}

function readPsStartTime(pid: number): string | null {
	try {
		const result = Bun.spawnSync(['ps', '-o', 'lstart=', '-p', String(pid)], {
			stdout: 'pipe',
			stderr: 'ignore'
		})
		if (result.exitCode !== 0) return null
		const start = result.stdout.toString().trim()
		return start ? `ps:${start}` : null
	} catch {
		return null
	}
}

function groupAlive(pgid: number): boolean {
	try {
		process.kill(-pgid, 0)
		return true
	} catch (err) {
		return (err as NodeJS.ErrnoException)?.code !== 'ESRCH'
	}
}

function signalGroup(pgid: number, signal: NodeJS.Signals): void {
	process.kill(-pgid, signal)
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms))
}

const defaultSleep = sleep

function readReceiptFile(path: string): RunReceipt | null {
	try {
		const raw = readFileSync(path, 'utf-8')
		const parsed = JSON.parse(raw) as Partial<RunReceipt>
		if (parsed.version !== RECEIPT_VERSION || !parsed.owner || !Array.isArray(parsed.processes)) return null
		return parsed as RunReceipt
	} catch {
		return null
	}
}

/**
 * Reap orphans from a previous run. Reads the receipt at `path`; when its
 * numux owner is still alive (same pid, same start time) everything is left
 * alone. Otherwise every entry whose start-time identity still matches is
 * signalled as a group — SIGTERM, a short bounded wait, then SIGKILL. Entries
 * whose identity no longer matches are never signalled. The receipt is removed
 * afterwards so it cannot be reaped twice.
 *
 * Windows has no process groups and this codebase has no tree-kill primitive
 * (`killProcessGroup` falls back to a direct PID kill there), so reaping is
 * skipped on win32.
 */
export async function reapOrphans(path: string, deps: ReapDeps = {}): Promise<ReapReport> {
	const platform = deps.platform ?? process.platform
	const empty: ReapReport = { action: 'none', reaped: [], skipped: [] }
	if (platform === 'win32') return { ...empty, action: 'windows-skipped' }
	if (!existsSync(path)) return empty

	const receipt = readReceiptFile(path)
	if (!receipt) {
		log(`Removing unreadable receipt: ${path}`)
		try {
			unlinkSync(path)
		} catch {
			// Already gone — nothing to reap either way
		}
		return empty
	}

	const currentPid = deps.currentPid ?? process.pid
	const isAlive = deps.isAlive ?? isPidAlive
	const readStart = deps.readStart ?? readProcessStart
	const signal = deps.signalGroup ?? signalGroup
	const alive = deps.groupAlive ?? groupAlive
	const wait = deps.sleep ?? defaultSleep
	const termWaitMs = deps.termWaitMs ?? REAP_TERM_WAIT_MS

	// Our own receipt from this run (or a concurrent writer) — never reap it.
	// An alive pid with a mismatched identity is a reused pid: the owner is gone.
	if (receipt.owner.pid === currentPid) return { ...empty, action: 'live' }
	if (isAlive(receipt.owner.pid) && readStart(receipt.owner.pid) === receipt.owner.startTime) {
		log(`Receipt owner ${receipt.owner.pid} still alive, leaving processes alone`)
		return { ...empty, action: 'live' }
	}

	const report: ReapReport = { action: 'reaped', reaped: [], skipped: [] }
	for (const entry of receipt.processes) {
		if (readStart(entry.pid) !== entry.startTime) {
			report.skipped.push(entry.name)
			continue
		}
		try {
			signal(entry.pgid, 'SIGTERM')
		} catch {
			// Group already gone
		}
		const deadline = Date.now() + termWaitMs
		while (alive(entry.pgid) && Date.now() < deadline) {
			await wait(50)
		}
		if (alive(entry.pgid)) {
			try {
				signal(entry.pgid, 'SIGKILL')
			} catch {
				// Group exited during escalation
			}
		}
		report.reaped.push(entry.name)
		log(`Reaped orphaned process group: ${entry.name} (pgid ${entry.pgid})`)
	}

	try {
		unlinkSync(path)
	} catch {
		// Another run already removed it
	}
	return report
}

/** One-line summary for startup output. Null when there is nothing to report. */
export function formatReapReport(report: ReapReport): string | null {
	if (report.action !== 'reaped') return null
	const parts: string[] = []
	if (report.reaped.length > 0) {
		const names = report.reaped.join(', ')
		parts.push(`reaped ${report.reaped.length} orphaned process group(s) from a previous run: ${names}`)
	}
	if (report.skipped.length > 0) {
		parts.push(`left ${report.skipped.length} non-matching pid(s) alone: ${report.skipped.join(', ')}`)
	}
	if (parts.length === 0) return null
	return `[numux] ${parts.join('; ')}`
}

/**
 * Keeps the receipt for the current run on disk. Constructed once at startup
 * with this process as owner; `sync` rewrites the file as processes start,
 * restart and exit, and an empty sync removes it. `clear` removes it on clean
 * shutdown. Writes are atomic (tmp file + rename) so a concurrent reader never
 * sees a partial receipt.
 *
 * Disabled on Windows (see `reapOrphans`): sync and clear are no-ops there.
 */
export class ReceiptStore {
	private path: string
	private owner: ReceiptOwner
	private enabled: boolean

	constructor(path: string, platform: NodeJS.Platform = process.platform) {
		this.path = path
		this.enabled = platform !== 'win32'
		const startTime = this.enabled ? (readProcessStart(process.pid, platform) ?? '') : ''
		this.owner = { pid: process.pid, startTime }
	}

	get filePath(): string {
		return this.path
	}

	sync(processes: TrackedProcess[]): void {
		if (!this.enabled) return
		const entries: ReceiptEntry[] = []
		for (const proc of processes) {
			const startTime = readProcessStart(proc.pid)
			// Unreadable means already exited — nothing to reap later
			if (startTime) entries.push({ name: proc.name, pid: proc.pid, pgid: proc.pgid, startTime })
		}
		if (entries.length === 0) {
			this.clear()
			return
		}
		const receipt: RunReceipt = {
			version: RECEIPT_VERSION,
			owner: this.owner,
			processes: entries,
			updatedAt: new Date().toISOString()
		}
		try {
			mkdirSync(receiptDir(), { recursive: true })
			const tmp = `${this.path}.${process.pid}.tmp`
			writeFileSync(tmp, JSON.stringify(receipt))
			renameSync(tmp, this.path)
		} catch (err) {
			log(`Failed to write receipt: ${err instanceof Error ? err.message : err}`)
		}
	}

	clear(): void {
		if (!this.enabled) return
		try {
			unlinkSync(this.path)
		} catch {
			// Already gone — clean shutdown stays quiet
		}
	}
}
