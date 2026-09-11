#!/usr/bin/env bun
/** Temporary diagnostic: where does the Windows exit code get lost? */
async function probe(name: string, argv: string[]): Promise<void> {
	try {
		const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore' })
		const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()])
		const code = await proc.exited
		console.info(
			`${name}: exited=${code} stdout=${JSON.stringify(out.slice(0, 200))} stderr=${JSON.stringify(err.slice(0, 200))}`
		)
	} catch (e) {
		console.info(`${name}: THREW ${e instanceof Error ? e.message : e}`)
	}
}

console.info(`platform=${process.platform} bun=${Bun.version}`)
await probe('A bun-direct-exit42', ['bun', '-e', 'process.exit(42)'])
await probe('B cmd-sh-bun-exit42', ['cmd', '/d', '/s', '/c', 'bun -e "process.exit(42)"'])
await probe('C cmd-builtin-exit42', ['cmd', '/d', '/s', '/c', 'exit 42'])
await probe('D cmd-sh-bun-echo', ['cmd', '/d', '/s', '/c', 'bun -e "console.log(1+1)"'])
await probe('E bun-direct-echo', ['bun', '-e', 'console.log("hi-probe")'])
await probe('F cmd-sh-fail-exe', ['cmd', '/d', '/s', '/c', 'nonexistent_cmd_xyz_123'])
