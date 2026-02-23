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

async function runPrefix(configPath: string): Promise<{ stdout: string; exitCode: number }> {
	const proc = Bun.spawn(['bun', INDEX, '--prefix', '-c', configPath], {
		stdout: 'pipe',
		stderr: 'pipe',
		env: { ...process.env, FORCE_COLOR: '0' }
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

	test('pads process names to equal width', async () => {
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
		// "a" should be padded to match "longname" length (8 chars)
		expect(stdout).toContain('[a       ]')
		expect(stdout).toContain('[longname]')
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
		// "first" should reach stopped status before "second" starts
		const firstStopped = stdout.indexOf('stopped')
		const secondOutput = stdout.indexOf('step2')
		expect(firstStopped).toBeLessThan(secondOutput)
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
		expect(stdout).toContain('[dep')
		expect(stdout).toContain('[child')
		expect(stdout).toContain('skipped')
		expect(stdout).not.toContain('should not run')
		expect(exitCode).toBe(1)
	}, 10000)
})
