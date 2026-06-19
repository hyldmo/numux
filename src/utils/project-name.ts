import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'

/** Resolve project name from package.json name (scope-stripped) or directory basename. */
export function resolveProjectName(cwd: string): string {
	try {
		const pkgPath = join(cwd, 'package.json')
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
			if (typeof pkg.name === 'string' && pkg.name.trim()) {
				// Strip npm scope (e.g. @org/name -> name)
				return pkg.name.replace(/^@[^/]+\//, '').trim()
			}
		}
	} catch {
		// Fall through to directory name
	}
	return basename(cwd)
}

/** Default log directory: /tmp/numux/<project-name> */
export function defaultLogDir(cwd: string): string {
	return join(tmpdir(), 'numux', resolveProjectName(cwd))
}
