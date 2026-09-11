#!/usr/bin/env bun
/**
 * Minimal Windows smoke check for `numux --prefix`.
 *
 * Runs a small parallel DAG with cross-platform commands only (`bun -e`,
 * no POSIX shell builtins), covering:
 *   1. parallel independent processes + a dependsOn join (ordering proves sequencing)
 *   2. a failing process (exit code propagates to numux exit 1)
 *   3. dependents of a failed process are skipped
 *   4. `true`-shorthand script auto-resolution (`lint: true` → `<pm> run lint`)
 *
 * Every scenario runs against both the source entry (`src/index.ts`) and the
 * built bundle (`dist/numux.js`): the bundle once shipped the whole UI graph
 * in a single chunk, hoisting native imports to top level and segfaulting
 * Windows at startup for every invocation shape.
 *
 * Exit 0 when all assertions hold, non-zero otherwise.
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const SRC_ENTRY = join(import.meta.dir, '..', 'src', 'index.ts')
const DIST_ENTRY = join(import.meta.dir, '..', 'dist', 'numux.js')

function makeDir(): string {
	const dir = join(tmpdir(), `numux-win-smoke-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`)
	mkdirSync(dir, { recursive: true })
	return dir
}

async function runPrefix(
	entry: string,
	config: unknown,
	options?: { cwd?: string; setup?: (dir: string) => void }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const dir = options?.cwd ?? makeDir()
	try {
		options?.setup?.(dir)
		const configPath = join(dir, 'numux.json')
		writeFileSync(configPath, JSON.stringify(config))
		const proc = Bun.spawn(['bun', entry, '--prefix', '--config', configPath], {
			cwd: dir,
			stdout: 'pipe',
			stderr: 'pipe',
			env: { ...process.env, FORCE_COLOR: '0' }
		})
		const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
		const exitCode = await proc.exited
		return { stdout, stderr, exitCode }
	} finally {
		if (!options?.cwd) rmSync(dir, { recursive: true, force: true })
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

async function check(entry: string, label: string): Promise<void> {
	console.info(`\n--- ${label} (${entry}) ---`)

	// 1. Parallel DAG with dependsOn join
	const dag = await runPrefix(entry, {
		processes: {
			alpha: { command: LOG('alpha-done') },
			beta: { command: LOG('beta-done') },
			gamma: { command: LOG('gamma-done'), dependsOn: ['alpha', 'beta'] }
		}
	})
	assert(dag.exitCode === 0, `[${label}] parallel DAG exits 0 (got ${dag.exitCode})`, dag.stdout + dag.stderr)
	assert(dag.stdout.includes('alpha-done'), `[${label}] parallel DAG prints alpha output`, dag.stdout)
	assert(dag.stdout.includes('beta-done'), `[${label}] parallel DAG prints beta output`, dag.stdout)
	assert(dag.stdout.includes('gamma-done'), `[${label}] parallel DAG prints gamma output`, dag.stdout)
	assert(
		dag.stdout.indexOf('alpha-done') < dag.stdout.indexOf('gamma-done') &&
			dag.stdout.indexOf('beta-done') < dag.stdout.indexOf('gamma-done'),
		`[${label}] dependsOn join runs after both parents`,
		dag.stdout
	)

	// 2. Failing process propagates exit code
	const fail = await runPrefix(entry, {
		processes: {
			ok: { command: LOG('ok-done') },
			bad: { command: FAIL_42 }
		}
	})
	assert(fail.exitCode === 1, `[${label}] failing DAG exits 1 (got ${fail.exitCode})`, fail.stdout + fail.stderr)
	assert(fail.stdout.includes('failed'), `[${label}] failing DAG summary shows failed`, fail.stdout)

	// 3. Dependents of a failed process are skipped
	const skip = await runPrefix(entry, {
		processes: {
			dep: { command: FAIL_42 },
			child: { command: LOG('child-should-not-run'), dependsOn: ['dep'] }
		}
	})
	assert(
		skip.exitCode === 1,
		`[${label}] skipped-dependent DAG exits 1 (got ${skip.exitCode})`,
		skip.stdout + skip.stderr
	)
	assert(skip.stdout.includes('skipped'), `[${label}] failed dependency marks child skipped`, skip.stdout)
	assert(!skip.stdout.includes('child-should-not-run'), `[${label}] skipped child never runs`, skip.stdout)

	// 4. `true`-shorthand script auto-resolution against package.json scripts
	const shorthand = await runPrefix(
		entry,
		{ processes: { 'smoke-a': true, 'smoke-b': { dependsOn: ['smoke-a'] } } },
		{
			setup: dir => {
				writeFileSync(
					join(dir, 'package.json'),
					JSON.stringify({
						name: 'smoke',
						packageManager: 'bun',
						scripts: { 'smoke-a': LOG('shorthand-a'), 'smoke-b': LOG('shorthand-b') }
					})
				)
			}
		}
	)
	assert(
		shorthand.exitCode === 0,
		`[${label}] shorthand DAG exits 0 (got ${shorthand.exitCode})`,
		shorthand.stdout + shorthand.stderr
	)
	assert(shorthand.stdout.includes('shorthand-a'), `[${label}] shorthand runs package script`, shorthand.stdout)
	assert(
		shorthand.stdout.indexOf('shorthand-a') < shorthand.stdout.indexOf('shorthand-b'),
		`[${label}] shorthand respects dependsOn order`,
		shorthand.stdout
	)
}

if (!existsSync(DIST_ENTRY)) {
	console.error(`FAIL: built bundle missing: ${DIST_ENTRY} (run \`bun run build\` first)`)
	process.exit(1)
}

await check(SRC_ENTRY, 'source')
await check(DIST_ENTRY, 'bundle')

if (process.exitCode) {
	console.error('\nWindows prefix smoke: FAILED')
} else {
	console.info('\nWindows prefix smoke: PASSED')
}
