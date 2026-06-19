import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INDEX = join(import.meta.dir, 'index.ts')
let tmpDir: string

beforeAll(() => {
	tmpDir = join(tmpdir(), `numux-logs-test-${Date.now()}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true })
})

function setupLogDir(name: string, files: Record<string, string>): string {
	const dir = join(tmpDir, name)
	mkdirSync(dir, { recursive: true })
	for (const [file, content] of Object.entries(files)) {
		writeFileSync(join(dir, file), content)
	}
	return dir
}

async function runLogs(
	logDir: string,
	processName?: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
	const args = ['bun', INDEX, '--log-dir', logDir, 'logs']
	if (processName) args.push(processName)
	const proc = Bun.spawn(args, {
		stdout: 'pipe',
		stderr: 'pipe'
	})
	const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
	const exitCode = await proc.exited
	return { stdout, stderr, exitCode }
}

describe('numux logs', () => {
	test('prints log directory path when no process specified', async () => {
		const dir = setupLogDir('bare', { 'api.log': 'hello' })
		const { stdout, exitCode } = await runLogs(dir)
		expect(exitCode).toBe(0)
		expect(stdout.trim()).toBe(dir)
	})

	test('prefers latest/ symlink when it exists', async () => {
		const base = join(tmpDir, 'with-latest')
		const sessionDir = join(base, '2025-01-01T00-00-00')
		mkdirSync(sessionDir, { recursive: true })
		writeFileSync(join(sessionDir, 'api.log'), 'from session')
		symlinkSync(sessionDir, join(base, 'latest'))

		const { stdout, exitCode } = await runLogs(base)
		expect(exitCode).toBe(0)
		expect(stdout.trim()).toBe(join(base, 'latest'))
	})

	test('pipes log file content for a specific process', async () => {
		const dir = setupLogDir('single', {
			'api.log': 'line 1\nline 2\n',
			'web.log': 'other'
		})
		const { stdout, exitCode } = await runLogs(dir, 'api')
		expect(exitCode).toBe(0)
		expect(stdout).toBe('line 1\nline 2\n')
	})

	test('exits 1 with available names when process not found', async () => {
		const dir = setupLogDir('missing', {
			'api.log': 'data',
			'web.log': 'data'
		})
		const { stderr, exitCode } = await runLogs(dir, 'db')
		expect(exitCode).toBe(1)
		expect(stderr).toContain('No log file for "db"')
		expect(stderr).toContain('api')
		expect(stderr).toContain('web')
	})

	test('exits 1 with message when no log files exist', async () => {
		const dir = setupLogDir('empty', {})
		const { stderr, exitCode } = await runLogs(dir, 'api')
		expect(exitCode).toBe(1)
		expect(stderr).toContain('No log files found')
	})

	test('reads from latest/ symlink for process logs', async () => {
		const base = join(tmpDir, 'latest-process')
		const sessionDir = join(base, '2025-01-01T00-00-00')
		mkdirSync(sessionDir, { recursive: true })
		writeFileSync(join(sessionDir, 'api.log'), 'session data\n')
		symlinkSync(sessionDir, join(base, 'latest'))

		const { stdout, exitCode } = await runLogs(base, 'api')
		expect(exitCode).toBe(0)
		expect(stdout).toBe('session data\n')
	})

	test('does not warn when --log-dir is explicit', async () => {
		const base = join(tmpDir, 'explicit-no-warn')
		const sessionDir = join(base, '2025-01-01T00-00-00')
		mkdirSync(sessionDir, { recursive: true })
		writeFileSync(join(sessionDir, 'api.log'), 'data')
		symlinkSync(sessionDir, join(base, 'latest'))

		const { stderr, exitCode } = await runLogs(base)
		expect(exitCode).toBe(0)
		expect(stderr).not.toContain('Warning:')
	})

	test('warns when default logDir is used and latest symlink exists', async () => {
		const cwd = join(tmpDir, 'default-warn')
		mkdirSync(cwd, { recursive: true })
		const base = join(tmpdir(), 'numux', 'default-warn')
		const sessionDir = join(base, '2025-01-01T00-00-00')
		mkdirSync(sessionDir, { recursive: true })
		writeFileSync(join(sessionDir, 'api.log'), 'data')
		try {
			symlinkSync(sessionDir, join(base, 'latest'))
		} catch {
			// Already exists from prior run — best effort
		}

		const proc = Bun.spawn(['bun', INDEX, 'logs'], {
			cwd,
			stdout: 'pipe',
			stderr: 'pipe'
		})
		const [stdout, stderr] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
		const exitCode = await proc.exited

		expect(exitCode).toBe(0)
		expect(stderr).toContain('Warning:')
		expect(stderr).toContain('latest')
		expect(stdout.trim()).toBe(join(base, 'latest'))

		// Cleanup the /tmp/numux/<basename> dir we created
		rmSync(base, { recursive: true, force: true })
	})
})
