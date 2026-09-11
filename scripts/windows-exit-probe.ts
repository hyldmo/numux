#!/usr/bin/env bun
/** Temporary diagnostic round 4: windowsVerbatimArguments + Node-style wrapped tail. */
async function probe(name: string, argv: string[], extra?: Record<string, unknown>): Promise<void> {
	try {
		const proc = Bun.spawn(argv, { stdout: 'pipe', stderr: 'pipe', stdin: 'ignore', ...extra })
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
const V = { windowsVerbatimArguments: true }
await probe('Q4 verbatim-quoteless', ['cmd', '/d', '/s', '/c', 'bun --version'], V)
await probe('Q1 verbatim-wrapped-quotes', ['cmd', '/d', '/s', '/c', '"bun -e "process.exit(52)""'], V)
await probe('Q5 verbatim-compound', ['cmd', '/d', '/s', '/c', '"echo one && bun -e "process.exit(53)""'], V)
