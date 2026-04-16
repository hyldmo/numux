import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stripCursorSequences } from './prefix'

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
	const env: Record<string, string | undefined> = { ...process.env, FORCE_COLOR: '0', ...envOverrides }
	if (!('NO_COLOR' in envOverrides)) delete env.NO_COLOR
	const proc = Bun.spawn(['bun', INDEX, '--prefix', ...extraArgs, '--config', configPath], {
		stdout: 'pipe',
		stderr: 'pipe',
		env
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
				processes: { hello: { command: "echo 'hello world'" } }
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
					aaa: { command: "echo 'from aaa'" },
					bbb: { command: "echo 'from bbb'" }
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
				processes: { bad: { command: "sh -c 'exit 1'" } }
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
					a: { command: "echo 'short'" },
					longname: { command: "echo 'long'" }
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
					first: { command: "echo 'step1'" },
					second: { command: "echo 'step2'", dependsOn: ['first'] }
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
					quick: { command: "echo 'done'" },
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
					bad: { command: "sh -c 'exit 42'" },
					slow: { command: 'sleep 60' }
				}
			})
		)
		const { exitCode } = await runPrefix(config, ['--kill-others'])
		expect(exitCode).toBe(1)
	}, 15000)

	test('--timestamps prepends HH:mm:ss.SSS to output lines', async () => {
		const config = writeConfig(
			'timestamps.json',
			JSON.stringify({
				processes: { ts: { command: "echo 'hello'" } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config, ['--timestamps'])
		// Should contain a timestamp like [12:34:56.789]
		expect(stdout).toMatch(/\[\d{2}:\d{2}:\d{2}\.\d{3}\]/)
		expect(stdout).toContain('hello')
		expect(exitCode).toBe(0)
	}, 10000)

	test('prints exit summary after all processes finish', async () => {
		const config = writeConfig(
			'summary.json',
			JSON.stringify({
				processes: {
					ok: { command: 'true' },
					fail: { command: "sh -c 'exit 2'" }
				}
			})
		)
		const { stdout } = await runPrefix(config)
		// Summary should appear after all output, showing status and exit codes
		const lines = stdout.split('\n')
		const summaryLines = lines.filter(l => l.includes('exit 2') && !l.startsWith('['))
		expect(summaryLines.length).toBeGreaterThan(0)
	}, 10000)

	test('bare carriage return collapses overwritten content', async () => {
		const config = writeConfig(
			'cr.json',
			JSON.stringify({
				processes: { cr: { command: "printf 'first\\rsecond\\n'" } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		const contentLines = stdout.split('\n').filter(l => l.startsWith('[cr]') && !l.includes('$'))
		// Bare \r simulates overwrite — only 'second' should appear, not 'first'
		expect(contentLines.some(l => l.includes('second'))).toBe(true)
		expect(contentLines.some(l => l.includes('first'))).toBe(false)
		for (const line of contentLines) {
			expect(line).not.toContain('\r')
		}
		expect(exitCode).toBe(0)
	}, 10000)

	test('multiple carriage returns keep only final overwrite', async () => {
		const config = writeConfig(
			'cr-multi.json',
			JSON.stringify({
				processes: { cr: { command: "printf 'frame1\\rframe2\\rframe3\\n'" } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		const contentLines = stdout.split('\n').filter(l => l.startsWith('[cr]') && !l.includes('$'))
		expect(contentLines.some(l => l.includes('frame3'))).toBe(true)
		expect(contentLines.some(l => l.includes('frame1'))).toBe(false)
		expect(contentLines.some(l => l.includes('frame2'))).toBe(false)
		expect(exitCode).toBe(0)
	}, 10000)

	test('CRLF line endings are not affected by carriage return collapsing', async () => {
		const config = writeConfig(
			'crlf.json',
			JSON.stringify({
				processes: { cr: { command: "printf 'line1\\r\\nline2\\r\\n'" } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		const contentLines = stdout.split('\n').filter(l => l.startsWith('[cr]') && !l.includes('$'))
		// Both lines should appear — \r\n is a normal line ending, not an overwrite
		expect(contentLines.some(l => l.includes('line1'))).toBe(true)
		expect(contentLines.some(l => l.includes('line2'))).toBe(true)
		expect(exitCode).toBe(0)
	}, 10000)

	test('trailing carriage return without newline is flushed on exit', async () => {
		const config = writeConfig(
			'cr-flush.json',
			JSON.stringify({
				processes: { cr: { command: "printf 'buffered\\rvisible'" } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		const contentLines = stdout.split('\n').filter(l => l.startsWith('[cr]') && !l.includes('$'))
		// 'visible' overwrites 'buffered', then flush on exit should emit 'visible'
		expect(contentLines.some(l => l.includes('visible'))).toBe(true)
		expect(contentLines.some(l => l.includes('buffered'))).toBe(false)
		expect(exitCode).toBe(0)
	}, 10000)

	test('normal lines mixed with carriage return lines', async () => {
		const config = writeConfig(
			'cr-mixed.json',
			JSON.stringify({
				processes: { cr: { command: "printf 'normal1\\nold\\rnew\\nnormal2\\n'" } }
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		const contentLines = stdout.split('\n').filter(l => l.startsWith('[cr]') && !l.includes('$'))
		expect(contentLines.some(l => l.includes('normal1'))).toBe(true)
		expect(contentLines.some(l => l.includes('new'))).toBe(true)
		expect(contentLines.some(l => l.includes('normal2'))).toBe(true)
		expect(contentLines.some(l => l.includes('old'))).toBe(false)
		expect(exitCode).toBe(0)
	}, 10000)

	test('strips ANSI from process output when NO_COLOR is set', async () => {
		const config = writeConfig(
			'no-color.json',
			JSON.stringify({
				processes: {
					ansi: { command: "printf '\\033[32mgreen\\033[0m plain'" }
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
					dep: { command: "sh -c 'exit 1'" },
					child: { command: "echo 'should not run'", dependsOn: ['dep'] }
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

	test('-o filters to named process and its deps', async () => {
		const config = writeConfig(
			'only-filter.json',
			JSON.stringify({
				processes: {
					db: { command: "echo 'db ready'" },
					api: { command: "echo 'api ready'", dependsOn: ['db'] },
					web: { command: "echo 'web ready'" }
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config, ['-o', 'api'])
		expect(stdout).toContain('[api]')
		expect(stdout).toContain('[db]')
		expect(stdout).not.toContain('[web]')
		expect(exitCode).toBe(0)
	}, 10000)

	test('repeated -o merges filters', async () => {
		const config = writeConfig(
			'only-repeated.json',
			JSON.stringify({
				processes: {
					a: { command: "echo 'a'" },
					b: { command: "echo 'b'" },
					c: { command: "echo 'c'" }
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config, ['-o', 'a', '-o', 'b'])
		expect(stdout).toContain('[a]')
		expect(stdout).toContain('[b]')
		expect(stdout).not.toContain('[c]')
		expect(exitCode).toBe(0)
	}, 10000)

	test('cursor-up sequences are stripped to preserve prefix', async () => {
		// Use bun -e to emit real escape bytes — avoids printf portability issues
		const config = writeConfig(
			'cursor-up.json',
			JSON.stringify({
				processes: {
					fmt: {
						command: `bun -e "process.stdout.write('header\\n\\x1b[1A\\x1b[2Kfile.md 35ms\\n')"`
					}
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		const contentLines = stdout.split('\n').filter(l => l.startsWith('[fmt]') && !l.includes('$'))
		// Every content line must have the [fmt] prefix
		expect(contentLines.some(l => l.includes('header'))).toBe(true)
		expect(contentLines.some(l => l.includes('file.md 35ms'))).toBe(true)
		// Cursor sequences must be stripped
		expect(stdout).not.toContain('\x1b[1A')
		expect(stdout).not.toContain('\x1b[2K')
		expect(exitCode).toBe(0)
	}, 10000)

	test('CHA col-1 sequence triggers overwrite instead of concatenation', async () => {
		// Progress displays often use \x1b[2K\x1b[G (erase-line + CHA col-1)
		// to overwrite the current line. CHA col-1 must become \r so the
		// overwrite logic keeps only the final content.
		const config = writeConfig(
			'cha-overwrite.json',
			JSON.stringify({
				processes: {
					cha: {
						command: `bun -e "process.stdout.write('file.ts\\x1b[2K\\x1b[1Gfile.ts 0ms (cached)\\n')"`
					}
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config, [], { NO_COLOR: '1' })
		const contentLines = stdout.split('\n').filter(l => l.startsWith('[cha]') && !l.includes('$'))
		// Should show only the final overwrite, not concatenated filenames
		expect(contentLines.some(l => l === '[cha] file.ts 0ms (cached)')).toBe(true)
		expect(exitCode).toBe(0)
	}, 10000)

	test('SGR color sequences are preserved', async () => {
		const config = writeConfig(
			'sgr-preserved.json',
			JSON.stringify({
				processes: {
					clr: {
						command: `bun -e "process.stdout.write('\\x1b[32mgreen\\x1b[0m\\n')"`
					}
				}
			})
		)
		const { stdout, exitCode } = await runPrefix(config)
		// SGR (color) sequences should pass through
		expect(stdout).toContain('\x1b[32m')
		expect(stdout).toContain('green')
		expect(exitCode).toBe(0)
	}, 10000)
})

describe('Summary formatting', () => {
	test('summary aligns status and exit codes into columns', async () => {
		const config = writeConfig(
			'summary-align.json',
			JSON.stringify({
				processes: {
					ok: { command: 'true' },
					fail: { command: "sh -c 'exit 2'" }
				}
			})
		)
		const { stdout } = await runPrefix(config, [], { NO_COLOR: '1' })
		// Summary lines start with two spaces and are not process output (no [brackets])
		const summaryLines = stdout.split('\n').filter(l => /^\s{2}\S/.test(l) && !l.startsWith('['))

		const okLine = summaryLines.find(l => /\bok\b/.test(l))
		const failLine = summaryLines.find(l => /\bfail\b/.test(l))
		expect(okLine).toBeDefined()
		expect(failLine).toBeDefined()

		// "finished" and "failed" are different lengths — padding should align exit codes
		const okExitIdx = okLine!.indexOf('(exit')
		const failExitIdx = failLine!.indexOf('(exit')
		expect(okExitIdx).toBe(failExitIdx)
	}, 10000)

	test('summary shows per-process duration', async () => {
		const config = writeConfig(
			'summary-duration.json',
			JSON.stringify({
				processes: {
					fast: { command: 'true' }
				}
			})
		)
		const { stdout } = await runPrefix(config, [], { NO_COLOR: '1' })
		// Summary line for the process should contain a duration (e.g. "42ms" or "1.2s")
		const lines = stdout.split('\n')
		const summaryLine = lines.find(l => l.includes('fast') && l.includes('finished'))
		expect(summaryLine).toBeDefined()
		expect(summaryLine).toMatch(/\d+(ms|\.?\d*s)/)
	}, 10000)

	test('summary shows duration for failed processes', async () => {
		const config = writeConfig(
			'summary-duration-fail.json',
			JSON.stringify({
				processes: {
					bad: { command: "sh -c 'exit 1'" }
				}
			})
		)
		const { stdout } = await runPrefix(config, [], { NO_COLOR: '1' })
		const lines = stdout.split('\n')
		const summaryLine = lines.find(l => l.includes('bad') && l.includes('failed'))
		expect(summaryLine).toBeDefined()
		expect(summaryLine).toMatch(/\d+(ms|\.?\d*s)/)
	}, 10000)

	test('skipped processes have no duration', async () => {
		const config = writeConfig(
			'summary-skipped.json',
			JSON.stringify({
				processes: {
					dep: { command: "sh -c 'exit 1'" },
					child: { command: 'true', dependsOn: ['dep'] }
				}
			})
		)
		const { stdout } = await runPrefix(config, [], { NO_COLOR: '1' })
		const lines = stdout.split('\n')
		const skippedLine = lines.find(l => l.includes('child') && l.includes('skipped'))
		expect(skippedLine).toBeDefined()
		// Skipped processes never started, so no duration should appear
		expect(skippedLine).not.toMatch(/\d+(ms|\.?\d*s)/)
	}, 10000)

	test('summary names are padded to equal width', async () => {
		const config = writeConfig(
			'summary-namepad.json',
			JSON.stringify({
				processes: {
					a: { command: 'true' },
					longname: { command: 'true' }
				}
			})
		)
		const { stdout } = await runPrefix(config, [], { NO_COLOR: '1' })
		const lines = stdout.split('\n')
		const aLine = lines.find(l => /^\s+a\s/.test(l) && l.includes('finished'))
		const longLine = lines.find(l => l.includes('longname') && l.includes('finished'))
		expect(aLine).toBeDefined()
		expect(longLine).toBeDefined()
		// Status text should start at the same column
		const aStatusIdx = aLine!.indexOf('finished')
		const longStatusIdx = longLine!.indexOf('finished')
		expect(aStatusIdx).toBe(longStatusIdx)
	}, 10000)
})

describe('stripCursorSequences', () => {
	test('strips cursor-up', () => {
		expect(stripCursorSequences('before\x1b[1Aafter')).toBe('beforeafter')
	})

	test('strips cursor-down', () => {
		expect(stripCursorSequences('before\x1b[2Bafter')).toBe('beforeafter')
	})

	test('strips erase-line', () => {
		expect(stripCursorSequences('\x1b[2Kcontent')).toBe('content')
	})

	test('strips erase-display', () => {
		expect(stripCursorSequences('\x1b[2Jcontent')).toBe('content')
	})

	test('strips cursor-position', () => {
		expect(stripCursorSequences('\x1b[5;10Hcontent')).toBe('content')
	})

	test('strips scroll-up and scroll-down', () => {
		expect(stripCursorSequences('\x1b[3S\x1b[3Tcontent')).toBe('content')
	})

	test('preserves SGR (color) sequences', () => {
		expect(stripCursorSequences('\x1b[32mgreen\x1b[0m')).toBe('\x1b[32mgreen\x1b[0m')
	})

	test('strips mixed cursor sequences while preserving colors', () => {
		const input = '\x1b[32m\x1b[1Agreen\x1b[2K\x1b[0m'
		expect(stripCursorSequences(input)).toBe('\x1b[32mgreen\x1b[0m')
	})

	test('returns plain text unchanged', () => {
		expect(stripCursorSequences('hello world')).toBe('hello world')
	})

	test('strips sequences without explicit count', () => {
		// \x1b[A is same as \x1b[1A (move up 1)
		expect(stripCursorSequences('before\x1b[Aafter')).toBe('beforeafter')
	})

	test('replaces CHA col-1 (\\x1b[G) with \\r', () => {
		expect(stripCursorSequences('file.ts\x1b[Gfile.ts 0ms')).toBe('file.ts\rfile.ts 0ms')
	})

	test('replaces CHA col-1 (\\x1b[1G) with \\r', () => {
		expect(stripCursorSequences('file.ts\x1b[1Gfile.ts 0ms')).toBe('file.ts\rfile.ts 0ms')
	})

	test('strips CHA with other columns', () => {
		// \x1b[5G (go to column 5) is not col-1, so strip it
		expect(stripCursorSequences('before\x1b[5Gafter')).toBe('beforeafter')
	})

	test('replaces CHA col-1 combined with erase-line', () => {
		// Common progress pattern: erase line + move to col 1
		expect(stripCursorSequences('file.ts\x1b[2K\x1b[1Gfile.ts 0ms')).toBe('file.ts\rfile.ts 0ms')
	})
})
