#!/usr/bin/env bun
/** Temporary diagnostic round 3: spaced-path script files + powershell-stdin route. */
import { mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function probe(name: string, argv: string[], stdinText?: string): Promise<void> {
	try {
		const proc = Bun.spawn(argv, {
			stdout: 'pipe',
			stderr: 'pipe',
			stdin: stdinText !== undefined ? 'pipe' : 'ignore'
		})
		if (stdinText !== undefined && proc.stdin) {
			const sink = proc.stdin as unknown as { write: (c: string) => number; end: () => void }
			sink.write(stdinText)
			sink.end()
		}
		const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
		const code = await proc.exited
		console.info(
			`${name}: exited=${code} stdout=${JSON.stringify(out.slice(0, 120))} stderr=${JSON.stringify(err.slice(0, 120))}`
		)
	} catch (e) {
		console.info(`${name}: THREW ${e instanceof Error ? e.message : e}`)
	}
}

console.info(`platform=${process.platform} bun=${Bun.version}`)
// Spaced directory (tmpdir on CI has no spaces, so craft one under cwd)
const spacedDir = join(process.cwd(), 'probe dir with spaces')
mkdirSync(spacedDir, { recursive: true })
const spacedScript = join(spacedDir, 'run.cmd')
writeFileSync(spacedScript, '@echo off\r\nbun -e "process.exit(50)"\r\n')
await probe('P10 spaced-script-libuv-quoted', ['cmd', '/d', '/s', '/c', spacedScript])
await probe(
	'P13 powershell-stdin',
	['powershell', '-NoProfile', '-NonInteractive', '-Command', '-'],
	'bun -e "process.exit(51)"\n'
)
console.info(`tmpdir=${tmpdir()}`)
