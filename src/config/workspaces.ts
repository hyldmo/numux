import { existsSync, readFileSync } from 'node:fs'
import { basename, resolve } from 'node:path'
import type { NumuxConfig, NumuxProcessConfig, ResolvedProcessConfig } from '../types'
import { detectPackageManager } from './expand-scripts'

export interface WorkspaceInfo {
	dir: string
	/** Scope-stripped pkg.name or dir basename */
	name: string
	/** Raw pkg.name (may include scope) */
	pkgName?: string
	scripts: Record<string, string>
}

/** Discover all workspaces from root package.json */
export function discoverWorkspaces(cwd: string): WorkspaceInfo[] {
	const pkgPath = resolve(cwd, 'package.json')
	if (!existsSync(pkgPath)) {
		throw new Error(`No package.json found in ${cwd}`)
	}

	const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>

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

	const workspaces: WorkspaceInfo[] = []
	for (const pattern of patterns) {
		const glob = new Bun.Glob(pattern)
		for (const match of glob.scanSync({ cwd, onlyFiles: false })) {
			const abs = resolve(cwd, match)
			const wsPkgPath = resolve(abs, 'package.json')
			if (!existsSync(wsPkgPath)) continue

			const wsPkg = JSON.parse(readFileSync(wsPkgPath, 'utf-8')) as Record<string, unknown>
			const pkgName = typeof wsPkg.name === 'string' && wsPkg.name ? wsPkg.name : undefined
			const name = pkgName ? pkgName.replace(/^@[^/]+\//, '') : basename(abs)
			const scripts = (wsPkg.scripts as Record<string, string> | undefined) ?? {}

			workspaces.push({ dir: abs, name, pkgName, scripts })
		}
	}

	return workspaces.sort((a, b) => a.name.localeCompare(b.name))
}

/** Find a workspace by package name (full or scope-stripped) or relative path */
export function findWorkspace(nameOrPath: string, workspaces: WorkspaceInfo[], cwd: string): WorkspaceInfo | undefined {
	// Match by full package name
	const byPkgName = workspaces.find(ws => ws.pkgName === nameOrPath)
	if (byPkgName) return byPkgName

	// Match by scope-stripped name
	const byName = workspaces.find(ws => ws.name === nameOrPath)
	if (byName) return byName

	// Fallback: match by relative path
	const absPath = resolve(cwd, nameOrPath)
	return workspaces.find(ws => ws.dir === absPath)
}

/** Extract script name from PM run commands like `npm run lint` */
export function extractScriptFromCommand(command: string): string | null {
	const match = command.match(/^(?:npm|yarn|pnpm|bun)\s+run\s+(\S+)/)
	return match ? match[1] : null
}

/** Expand `workspaces` field on process configs into per-workspace processes */
export function expandWorkspaces(config: NumuxConfig): NumuxConfig {
	const cwd = config.cwd ? resolve(config.cwd) : process.cwd()
	const newProcesses: NumuxConfig['processes'] = {}
	let discoveredWorkspaces: WorkspaceInfo[] | null = null

	for (const [name, entry] of Object.entries(config.processes)) {
		// Pass through string shorthand, true shorthand, and non-workspace entries
		if (typeof entry === 'string' || entry === true || !entry.workspaces) {
			newProcesses[name] = entry
			continue
		}

		const proc = entry as NumuxProcessConfig
		const wsField = proc.workspaces!

		// Validation
		if (!proc.command) {
			throw new Error(`Process "${name}": workspaces requires a "command"`)
		}
		if (proc.cwd) {
			throw new Error(`Process "${name}": cannot set both "workspaces" and "cwd"`)
		}

		// Lazy-discover workspaces
		if (!discoveredWorkspaces) {
			discoveredWorkspaces = discoverWorkspaces(cwd)
		}
		if (discoveredWorkspaces.length === 0) {
			throw new Error(`Process "${name}": no workspaces found`)
		}

		// Build template config (strip workspaces field)
		const { workspaces: _, ...template } = proc

		let targets: WorkspaceInfo[]

		if (wsField === true) {
			// All workspaces, optionally filtered by script
			const script = extractScriptFromCommand(proc.command)
			if (script) {
				targets = discoveredWorkspaces.filter(ws => ws.scripts[script])
				if (targets.length === 0) {
					throw new Error(`Process "${name}": no workspaces have a "${script}" script`)
				}
			} else {
				targets = discoveredWorkspaces
			}
		} else {
			// Specific workspace(s)
			const names = Array.isArray(wsField) ? wsField : [wsField as string]
			targets = []
			for (const wsName of names) {
				const ws = findWorkspace(wsName, discoveredWorkspaces, cwd)
				if (!ws) {
					const available = discoveredWorkspaces.map(w => w.name).join(', ')
					throw new Error(`Process "${name}": workspace "${wsName}" not found. Available: ${available}`)
				}
				targets.push(ws)
			}
		}

		// Expand into named processes
		const usedNames = new Set(Object.keys(newProcesses))
		for (const ws of targets) {
			let wsKey = `${name}:${ws.name}`
			if (usedNames.has(wsKey)) {
				let suffix = 1
				while (usedNames.has(`${wsKey}-${suffix}`)) suffix++
				wsKey = `${wsKey}-${suffix}`
			}
			usedNames.add(wsKey)
			newProcesses[wsKey] = { ...template, cwd: ws.dir }
		}
	}

	return { ...config, processes: newProcesses }
}

/** Resolve workspace processes for the -w CLI flag (backward compat) */
export function resolveWorkspaceProcesses(script: string, cwd: string): Record<string, ResolvedProcessConfig> {
	const pkgPath = resolve(cwd, 'package.json')
	if (!existsSync(pkgPath)) {
		throw new Error(`No package.json found in ${cwd}`)
	}

	const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
	const pm = detectPackageManager(pkgJson, cwd)
	const workspaces = discoverWorkspaces(cwd)

	const processes: Record<string, ResolvedProcessConfig> = {}
	const usedNames = new Set<string>()

	for (const ws of workspaces) {
		if (!ws.scripts[script]) continue

		let name = ws.name
		if (usedNames.has(name)) {
			let suffix = 1
			while (usedNames.has(`${name}-${suffix}`)) suffix++
			name = `${name}-${suffix}`
		}
		usedNames.add(name)

		processes[name] = {
			command: `${pm} run ${script}`,
			cwd: ws.dir
		}
	}

	if (Object.keys(processes).length === 0) {
		throw new Error(`No workspaces have a "${script}" script`)
	}

	return processes
}
