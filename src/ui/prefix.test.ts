import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const INDEX = join(import.meta.dir, '../index.ts')
let tmpDir: string

beforeAll(() => {
	tmpDir = join(tmpdir(), `numux-prefix-test-${Date.now()}`)
	mkdirSync(tmpDir, { recursive: true })
})

afterAll(() => {
	rmSync(tmpDir, { recursive: true, force: true })
})

function writeConfig(name: string, content: string): string {
	const path = join(tmpDir, name)
	writeFileSync(path, content)
	return path
}

async function runPrefix(
	configPath: string,
	extraArgs: string[] = [],
	envOverrides: Record<string, string> = {}
): Promise<{ stdout: string; exitCode: number }> {
	const proc = Bun.spawn(['bun', INDEX, '--prefix', ...extraArgs, '--config', configPath], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, FORCE_COLOR: '0', ...envOverrides }
	})
	const stdout = await new Response(proc.stdout).text()
	const exitCode = await proc.exited
	return { stdout, exitCode }
}

describe('PrefixDisplay (integration)', () => {
	test('prints prefixed output for a simple command', async () => {
		const config = writeConfig(
			'simple.json',
			JSON.stringify({
				processes: { hello: { command: "echo 'hello world'", persistent: false } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config)
		expect(stdout).toContain('[hello]')
		expect(stdout).toContain('hello world')
		expect(exitCode).toBe(0)
	}, 10000)

	test('prints output from multiple processes', async () => {
		const config = writeConfig(
			'multi.json',
			JSON.stringify({
				processes: {
					aaa: { command: "echo 'from aaa'", persistent: false },
					bbb: { command: "echo 'from bbb'", persistent: false }
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config)
		expect(stdout).toContain('[aaa]')
		expect(stdout).toContain('from aaa')
		expect(stdout).toContain('[bbb]')
		expect(stdout).toContain('from bbb')
		expect(exitCode).toBe(0)
	}, 10000)

	test('exits with code 1 when a process fails', async () => {
		const config = writeConfig(
			'fail.json',
			JSON.stringify({
				processes: { bad: { command: "sh -c 'exit 1'", persistent: false } }
			})
		)
		const { exitCode } = await runPrefix(config)
		expect(exitCode).toBe(1)
	}, 10000)

	test('does not pad process names', async () => {
		const config = writeConfig(
			'padding.json',
			JSON.stringify({
				processes: {
					a: { command: "echo 'short'", persistent: false },
					longname: { command: "echo 'long'", persistent: false }
				}
			})
		)
		const { stdout } = await runPrefix(config)
		expect(stdout).toContain('[a]')
		expect(stdout).toContain('[longname]')
		// Should not have trailing spaces inside brackets
		expect(stdout).not.toContain('[a ')
	}, 10000)

	test('respects dependency order', async () => {
		const config = writeConfig(
			'deps.json',
			JSON.stringify({
				processes: {
					first: { command: "echo 'step1'", persistent: false },
					second: { command: "echo 'step2'", persistent: false, dependsOn: ['first'] }
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config)
		// Both should appear in output
		expect(stdout).toContain('step1')
		expect(stdout).toContain('step2')
		// "first" output should appear before "second" output
		const firstOutput = stdout.indexOf('step1')
		const secondOutput = stdout.indexOf('step2')
		expect(firstOutput).toBeLessThan(secondOutput)
		expect(exitCode).toBe(0)
	}, 10000)

	test('--kill-others exits when first process exits', async () => {
		const config = writeConfig(
			'kill-others.json',
			JSON.stringify({
				processes: {
					quick: { command: "echo 'done'", persistent: false },
					slow: { command: 'sleep 60' }
				}
			})
		)
		const { exitCode } = await runPrefix(config, ['--kill-others'])
		// Should exit quickly (not wait for sleep 60) because "quick" exited
		expect(exitCode).toBe(0)
	}, 15000)

	test('--kill-others exits 1 when process fails', async () => {
		const config = writeConfig(
			'kill-others-fail.json',
			JSON.stringify({
				processes: {
					bad: { command: "sh -c 'exit 42'", persistent: false },
					slow: { command: 'sleep 60' }
				}
			})
		)
		const { exitCode } = await runPrefix(config, ['--kill-others'])
		expect(exitCode).toBe(1)
	}, 15000)

	test('--timestamps prepends HH:MM:SS to output lines', async () => {
		const config = writeConfig(
			'timestamps.json',
			JSON.stringify({
				processes: { ts: { command: "echo 'hello'", persistent: false } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config, ['--timestamps'])
		// Should contain a timestamp like [12:34:56]
		expect(stdout).toMatch(/\[\d{2}:\d{2}:\d{2}\]/)
		expect(stdout).toContain('hello')
		expect(exitCode).toBe(0)
	}, 10000)

	test('prints exit summary after all processes finish', async () => {
		const config = writeConfig(
			'summary.json',
			JSON.stringify({
				processes: {
					ok: { command: 'true', persistent: false },
					fail: { command: "sh -c 'exit 2'", persistent: false }
				}
			})
		)
		const { stdout } = await runPrefix(config)
		// Summary should appear after all output, showing status and exit codes
		const lines = stdout.split('\n')
		const summaryLines = lines.filter(l => l.includes('exit 2') && !l.startsWith('['))
		expect(summaryLines.length).toBeGreaterThan(0)
	}, 10000)

	test('strips ANSI from process output when NO_COLOR is set', async () => {
		const config = writeConfig(
			'no-color.json',
			JSON.stringify({
				processes: {
					ansi: { command: "printf '\\033[32mgreen\\033[0m plain'", persistent: false }
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		expect(stdout).toContain('green plain')
		expect(stdout).not.toContain('\x1b[')
		expect(exitCode).toBe(0)
	}, 10000)

	test('skips dependents of failed processes', async () => {
		const config = writeConfig(
			'skip.json',
			JSON.stringify({
				processes: {
					dep: { command: "sh -c 'exit 1'", persistent: false },
					child: { command: "echo 'should not run'", persistent: false, dependsOn: ['dep'] }
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config)
		// Summary should show dep as failed and child as skipped
		expect(stdout).toContain('failed')
		expect(stdout).toContain('skipped')
		expect(stdout).not.toContain('should not run')
		expect(exitCode).toBe(1)
	}, 10000)
})
