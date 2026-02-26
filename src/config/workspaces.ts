import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { ResolvedProcessConfig } from '../types'
import { detectPackageManager } from './expand-scripts'

export function resolveWorkspaceProcesses(script: string, cwd: string): Record<string, ResolvedProcessConfig> {
	const pkgPath = resolve(cwd, 'package.json')
	if (!existsSync(pkgPath)) {
		throw new Error(`No package.json found in ${cwd}`)
	}

	const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
	const pm = detectPackageManager(pkgJson, cwd)

	// Extract workspace globs — supports array or Yarn v1 { packages: [...] } format
	const raw = pkgJson.workspaces
	let patterns: string[]
	if (Array.isArray(raw)) {
		patterns = raw as string[]
	} else if (raw && typeof raw === 'object' && Array.isArray((raw as Record<string, unknown>).packages)) {
		patterns = (raw as Record<string, unknown>).packages as string[]
	} else {
		throw new Error('No "workspaces" field found in package.json')
	}

	// Resolve workspace globs to directories
	const dirs: string[] = []
	for (const pattern of patterns) {
		const glob = new Bun.Glob(pattern)
		for (const match of glob.scanSync({ cwd, onlyFiles: false })) {
			const abs = resolve(cwd, match)
			const wsPkgPath = resolve(abs, 'package.json')
			if (existsSync(wsPkgPath)) {
				dirs.push(abs)
			}
		}
	}

	// Build process configs for workspaces that have the script
	const processes: Record<string, ResolvedProcessConfig> = {}
	const usedNames = new Set<string>()

	for (const dir of dirs) {
		const wsPkgPath = resolve(dir, 'package.json')
		const wsPkg = JSON.parse(readFileSync(wsPkgPath, 'utf-8')) as Record<string, unknown>
		const scripts = wsPkg.scripts as Record<string, string> | undefined

		if (!scripts?.[script]) continue

		// Derive name: pkg.name stripped of @scope/ prefix, or directory basename
		let name: string
		if (typeof wsPkg.name === 'string' && wsPkg.name) {
			name = wsPkg.name.replace(/^@[^/]+\//, '')
		} else {
			name = basename(dir)
		}

		// Deduplicate names
		if (usedNames.has(name)) {
			let suffix = 1
			while (usedNames.has(`${name}-${suffix}`)) suffix++
			name = `${name}-${suffix}`
		}
		usedNames.add(name)

		processes[name] = {
			command: `${pm} run ${script}`,
			cwd: dir,
			persistent: true
		}
	}

	if (Object.keys(processes).length === 0) {
		throw new Error(`No workspaces have a "${script}" script`)
	}

	return processes
}
