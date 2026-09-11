#!/usr/bin/env bun
/**
 * Minimal Windows smoke check for `numux --prefix`.
 *
 * Runs a small parallel DAG with cross-platform commands only (`bun -e`,
 * no POSIX shell builtins), covering:
 *   1. parallel independent processes + a dependsOn join (ordering proves sequencing)
 *   2. a failing process (exit code propagates to numux exit 1)
 *   3. dependents of a failed process are skipped
 *
 * Exit 0 when all assertions hold, non-zero otherwise.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INDEX = join(import.meta.dir, '..', 'src', 'index.ts')

async function runPrefix(config: unknown): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const dir = join(tmpdir(), `numux-win-smoke-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(dir, { recursive: true })
	try {
		const configPath = join(dir, 'numux.json')
		writeFileSync(configPath, JSON.stringify(config))
		const proc = Bun.spawn(['bun', INDEX, '--prefix', '--config', configPath], {
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env, FORCE_COLOR: '0' }
		})
		const [stdout, stderr] = await Promise.all([
			new Response(proc.stdout).text(),
			new Response(proc.stderr).text()
		])
		const exitCode = await proc.exited
		return { stdout, stderr, exitCode }
	} finally {
		rmSync(dir, { recursive: true, force: true })
	}
}

function assert(cond: boolean, message: string, detail?: string): void {
	if (!cond) {
		console.error(`FAIL: ${message}`)
		if (detail) console.error(detail)
		process.exitCode = 1
	} else {
		console.info(`ok: ${message}`)
	}
}

// Cross-platform commands: `bun -e` works on cmd.exe, PowerShell, and sh.
const LOG = (marker: string) => `bun -e "console.log('${marker}')"`
const FAIL_42 = `bun -e "process.exit(42)"`

// 1. Parallel DAG with dependsOn join
const dag = await runPrefix({
	processes: {
		alpha: { command: LOG('alpha-done') },
		beta: { command: LOG('beta-done') },
		gamma: { command: LOG('gamma-done'), dependsOn: ['alpha', 'beta'] }
	}
})
assert(dag.exitCode === 0, `parallel DAG exits 0 (got ${dag.exitCode})`, dag.stdout + dag.stderr)
assert(dag.stdout.includes('alpha-done'), 'parallel DAG prints alpha output', dag.stdout)
assert(dag.stdout.includes('beta-done'), 'parallel DAG prints beta output', dag.stdout)
assert(dag.stdout.includes('gamma-done'), 'parallel DAG prints gamma output', dag.stdout)
assert(
	dag.stdout.indexOf('alpha-done') < dag.stdout.indexOf('gamma-done') &&
		dag.stdout.indexOf('beta-done') < dag.stdout.indexOf('gamma-done'),
	'dependsOn join runs after both parents',
	dag.stdout
)

// 2. Failing process propagates exit code
const fail = await runPrefix({
	processes: {
		ok: { command: LOG('ok-done') },
		bad: { command: FAIL_42 }
	}
})
assert(fail.exitCode === 1, `failing DAG exits 1 (got ${fail.exitCode})`, fail.stdout + fail.stderr)
assert(fail.stdout.includes('failed'), 'failing DAG summary shows failed', fail.stdout)

// 3. Dependents of a failed process are skipped
const skip = await runPrefix({
	processes: {
		dep: { command: FAIL_42 },
		child: { command: LOG('child-should-not-run'), dependsOn: ['dep'] }
	}
})
assert(skip.exitCode === 1, `skipped-dependent DAG exits 1 (got ${skip.exitCode})`, skip.stdout + skip.stderr)
assert(skip.stdout.includes('skipped'), 'failed dependency marks child skipped', skip.stdout)
assert(!skip.stdout.includes('child-should-not-run'), 'skipped child never runs', skip.stdout)

if (process.exitCode) {
	console.error('\nWindows prefix smoke: FAILED')
} else {
	console.info('\nWindows prefix smoke: PASSED')
}
