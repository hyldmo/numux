import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NumuxConfig, NumuxProcessConfig } from '../types'

type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

const LOCKFILE_PM: [string, PackageManager][] = [
	['bun.lockb', 'bun'],
	['bun.lock', 'bun'],
	['yarn.lock', 'yarn'],
	['pnpm-lock.yaml', 'pnpm'],
	['package-lock.json', 'npm']
]

export function detectPackageManager(pkgJson: Record<string, unknown>, cwd: string): PackageManager {
	const field = pkgJson.packageManager
	if (typeof field === 'string') {
		const name = field.split('@')[0] as PackageManager
		if (['npm', 'yarn', 'pnpm', 'bun'].includes(name)) return name
	}
	for (const [file, pm] of LOCKFILE_PM) {
		if (existsSync(resolve(cwd, file))) return pm
	}
	return 'npm'
}

/** Check whether a process name contains glob metacharacters (*, ?, [) */
function isGlobPattern(name: string): boolean {
	return /[*?[]/.test(name)
}

/** Derive a short display name by stripping the literal prefix & suffix of the
 *  glob pattern from the matched script name.
 *  e.g. pattern "dev:*" + script "dev:web" → "web"
 *       pattern "*:dev" + script "store:dev" → "store" */
function deriveShortName(pattern: string, scriptName: string): string {
	let prefixEnd = 0
	while (prefixEnd < pattern.length && !'*?['.includes(pattern[prefixEnd])) {
		prefixEnd++
	}
	let suffixStart = pattern.length
	while (suffixStart > 0 && !'*?['.includes(pattern[suffixStart - 1])) {
		suffixStart--
	}
	const prefix = pattern.slice(0, prefixEnd)
	const suffix = pattern.slice(suffixStart)

	let short = scriptName
	if (prefix && short.startsWith(prefix)) short = short.slice(prefix.length)
	if (suffix && short.endsWith(suffix)) short = short.slice(0, short.length - suffix.length)

	return short || scriptName
}

/** Split a pattern into the glob portion and any trailing args.
 *  Script names never contain spaces, so the first space is unambiguous. */
function splitPatternArgs(raw: string): { glob: string; extraArgs: string } {
	const i = raw.indexOf(' ')
	if (i === -1) return { glob: raw, extraArgs: '' }
	return { glob: raw.slice(0, i), extraArgs: raw.slice(i) }
}

export function expandScriptPatterns(config: NumuxConfig, cwd?: string): NumuxConfig {
	const entries = Object.entries(config.processes)
	const hasWildcard = entries.some(([name]) => name.startsWith('npm:') || isGlobPattern(name))
	if (!hasWildcard) return config

	const dir = config.cwd ?? cwd ?? process.cwd()
	const pkgPath = resolve(dir, 'package.json')

	if (!existsSync(pkgPath)) {
		throw new Error(`Wildcard patterns require a package.json (looked in ${dir})`)
	}

	const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
	const scripts = pkgJson.scripts as Record<string, string> | undefined
	if (!scripts || typeof scripts !== 'object') {
		throw new Error('package.json has no "scripts" field')
	}

	const scriptNames = Object.keys(scripts)
	const pm = detectPackageManager(pkgJson, dir)

	const expanded: Record<string, NumuxProcessConfig | string> = {}

	for (const [name, value] of entries) {
		if (!(name.startsWith('npm:') || isGlobPattern(name))) {
			expanded[name] = value as NumuxProcessConfig | string
			continue
		}

		const rawPattern = name.startsWith('npm:') ? name.slice(4) : name
		const { glob: globPattern, extraArgs } = splitPatternArgs(rawPattern)
		const template = (value ?? {}) as Partial<NumuxProcessConfig>

		if (template.command) {
			throw new Error(
				`"${name}": wildcard processes cannot have a "command" field (commands come from package.json scripts)`
			)
		}

		const glob = new Bun.Glob(globPattern)
		const matches = scriptNames.filter(s => glob.match(s))

		if (matches.length === 0) {
			throw new Error(
				`"${name}": no scripts matched pattern "${globPattern}". Available scripts: ${scriptNames.join(', ')}`
			)
		}

		const colors = Array.isArray(template.color) ? template.color : undefined
		const singleColor = typeof template.color === 'string' ? template.color : undefined

		for (let i = 0; i < matches.length; i++) {
			const scriptName = matches[i]
			const displayName = deriveShortName(globPattern, scriptName)

			if (expanded[displayName]) {
				throw new Error(`"${name}": expanded script "${scriptName}" collides with an existing process name`)
			}

			const color = colors ? colors[i % colors.length] : singleColor

			const { color: _color, ...rest } = template
			expanded[displayName] = {
				...rest,
				command: `${pm} run ${scriptName}${extraArgs}`,
				...(color ? { color } : {})
			} as NumuxProcessConfig
		}
	}

	return { ...config, processes: expanded }
}
