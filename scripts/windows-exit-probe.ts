#!/usr/bin/env bun
/** Temporary diagnostic round 2: find a cmd invocation form that preserves quotes. */
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

async function probe(name: string, argv: string[]): Promise<void> {
	try {
		const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
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
await probe('P1 echo-tail', ['cmd', '/d', '/s', '/c', 'echo hello-tail'])
await probe('P8 bun-version-noquotes', ['cmd', '/d', '/s', '/c', 'bun --version'])
await probe('P2 no-S', ['cmd', '/d', '/c', 'bun -e "process.exit(43)"'])
await probe('P3 bare-C', ['cmd', '/c', 'bun -e "process.exit(44)"'])
await probe('P4 prequoted-args', ['cmd', '/d', '/s', '/c', '"bun" "-e" "process.exit(45)"'])
await probe('P9 wrapped-tail', ['cmd', '/d', '/s', '/c', '"bun -e "process.exit(49)""'])
// Script-file route: zero quoting through the spawn boundary
const scriptPath = join(tmpdir(), `numux-probe-${process.pid}.cmd`)
writeFileSync(scriptPath, '@echo off\r\nbun -e "process.exit(48)"\r\n')
await probe('P7 script-file', ['cmd', '/d', '/s', '/c', scriptPath])
