import { copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import type { BunPlugin } from 'bun'

/**
 * Bundle patched dependencies into the output.
 *
 * ghostty-opentui has a patchedDependencies entry that fixes a crash,
 * but patches aren't transitive — npm consumers would get the unpatched
 * version. We bundle the patched terminal-buffer code while keeping the
 * native FFI module external (it resolves from the installed package at
 * runtime).
 */
const bundlePatches: BunPlugin = {
	name: 'bundle-patches',
	setup(build) {
		// ghostty-opentui/terminal-buffer imports ./ffi which has native
		// binaries. Rewrite the import to a virtual specifier, then mark
		// that specifier as external pointing to the installed package.
		build.onLoad({ filter: /ghostty-opentui[\\/]src[\\/]terminal-buffer\.ts$/ }, async args => {
			const contents = await Bun.file(args.path).text()
			return {
				contents: contents.replace(/from ['"]\.\/ffi(\.js|\.ts)?['"]/, 'from "ghostty-opentui"'),
				loader: 'ts'
			}
		})

		// Mark the root ghostty-opentui import (ffi) as external so native
		// modules resolve from the installed package at runtime.
		build.onResolve({ filter: /^ghostty-opentui$/ }, () => ({
			path: 'ghostty-opentui',
			external: true
		}))
	}
}

// Main bundle — includes patched ghostty-opentui/terminal-buffer
const main = await Bun.build({
	entrypoints: ['src/index.ts'],
	outdir: 'dist',
	target: 'bun',
	external: ['@opentui/core'],
	naming: { entry: 'numux.js' },
	plugins: [bundlePatches]
})

if (!main.success) {
	console.error('Build failed (main):')
	for (const log of main.logs) console.error(log)
	process.exit(1)
}

// Clean up .node asset files emitted by the bundler (these are resolved
// from the installed ghostty-opentui package at runtime, not from dist/)
for (const file of readdirSync('dist')) {
	if (file.endsWith('.node')) rmSync(`dist/${file}`)
}

// Config bundle — public API, all deps external
const config = await Bun.build({
	entrypoints: ['src/config.ts'],
	outdir: 'dist',
	target: 'bun',
	packages: 'external',
	naming: { entry: 'config.js' }
})

if (!config.success) {
	console.error('Build failed (config):')
	for (const log of config.logs) console.error(log)
	process.exit(1)
}

// Type declarations
const tsc = Bun.spawnSync([
	'bunx',
	'tsc',
	'src/config.ts',
	'src/types.ts',
	'--emitDeclarationOnly',
	'--declaration',
	'--outDir',
	'dist',
	'--target',
	'ESNext',
	'--module',
	'ESNext',
	'--moduleResolution',
	'bundler'
])

if (tsc.exitCode !== 0) {
	console.error('tsc failed:', tsc.stderr.toString())
	process.exit(1)
}

// Bin wrapper
copyFileSync('src/bin-wrapper.js', 'dist/bin.js')

// Man page
mkdirSync('dist/man', { recursive: true })
copyFileSync('man/numux.1', 'dist/man/numux.1')
