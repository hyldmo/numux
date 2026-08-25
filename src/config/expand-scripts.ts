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

/**
 * Detect the package manager from `packageManager` field in package.json
 * or by checking for lockfiles. Falls back to npm.
 */
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

/** Check whether a config entry should be treated as a package.json script reference.
 *  Colon-containing names (like `lint:eslint`) are script references unless
 *  the value is a string (explicit command) or an object with a `command` field. */
function isScriptReference(name: string, value: unknown): boolean {
	if (name.startsWith('npm:') || isGlobPattern(name)) return true
	if (!name.includes(':')) return false
	if (typeof value === 'string') return false
	if (value && typeof value === 'object' && 'command' in value) return false
	return true
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

/** Convert a script name (with optional extra args) into a `<pm> run <script>` command.
 *
 * Only npm needs a `--` separator — it swallows args that come after the script
 * name. yarn and pnpm forward those args as-is and pass a literal `--` through to
 * the script (which breaks flag parsing in most CLIs); bun accepts either form. */
function expandScriptCommand(raw: string, pm: PackageManager): string {
	const { glob: script, extraArgs } = splitPatternArgs(raw)
	if (extraArgs) {
		const separator = pm === 'npm' ? ' --' : ''
		return `${pm} run ${script}${separator}${extraArgs}`
	}
	return `${pm} run ${script}`
}

/**
 * Expand script references, glob patterns, and auto-resolved entries in the config.
 *
 * ## Script pattern rules
 *
 * **Recognition:** A process name is treated as a script reference when it:
 * - starts with `npm:` (e.g. `npm:dev:*`)
 * - contains glob metacharacters (`*`, `?`, `[`)
 * - contains a colon AND has no explicit `command` (e.g. `lint:eslint: {}`)
 *
 * **Glob matching:** Patterns are matched against `package.json` scripts using
 * `Bun.Glob`. The `*` wildcard does NOT match across `:` separators — `dev:*`
 * matches `dev:web` but not `dev:web:hmr`. Use `dev:*:*` for two levels deep.
 *
 * **Leaf-only (`^`):** Append `^` to skip scripts that are group runners —
 * scripts that have sub-scripts beneath them. E.g. if `format:check` has
 * `format:check:store` and `format:check:odoo` below it, `format:*^` excludes
 * `format:check` but keeps the leaf scripts.
 *
 * **Extra args:** Anything after the first space in the pattern is forwarded
 * as extra arguments to each matched command: `lint:* --fix` → `bun run lint:js --fix`.
 * npm is the only package manager that needs a `--` separator, so it gets one:
 * `npm run lint:js -- --fix`.
 *
 * **Template inheritance:** Config properties on a pattern entry (color, env,
 * dependsOn, etc.) are inherited by all expanded processes. Color arrays are
 * distributed round-robin across matches.
 *
 * **Display names:** The glob's literal prefix and suffix are stripped from
 * matched script names: `dev:*` + `dev:web` → display name `web`.
 *
 * ## Auto-resolution
 *
 * When a process has no `command` and its name matches a `package.json` script,
 * the command is auto-resolved to `<pm> run <name>`. This works for:
 * - `true` or `{}` shorthand: `lint: true` → `bun run lint`
 * - Objects without `command`: `typecheck: { dependsOn: ['db'] }` → `bun run typecheck`
 *
 * ## npm: prefix
 *
 * Commands starting with `npm:` are rewritten to use the detected package
 * manager: `npm:dev` → `bun run dev` (if bun is detected).
 */
export function expandScriptPatterns(config: NumuxConfig, cwd?: string): NumuxConfig {
	const entries = Object.entries(config.processes)
	const cmd = (v: unknown) => (typeof v === 'string' ? v : (v as { command?: string })?.command)
	const hasScriptRef = entries.some(([name, value]) => isScriptReference(name, value))
	const hasNpmCommand = entries.some(([, v]) => {
		const c = cmd(v)
		return typeof c === 'string' && c.startsWith('npm:')
	})
	const hasCommandlessEntry = entries.some(([, v]) => {
		if (v == null || v === true) return true
		if (typeof v === 'object' && !('command' in v)) return true
		return false
	})
	if (!(hasScriptRef || hasNpmCommand || hasCommandlessEntry)) return config

	const dir = config.cwd ?? cwd ?? process.cwd()
	const pkgPath = resolve(dir, 'package.json')
	if (!existsSync(pkgPath) && hasScriptRef) {
		throw new Error(`Wildcard patterns require a package.json (looked in ${dir})`)
	}
	const pkgJson = existsSync(pkgPath) ? (JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>) : {}
	const scripts = pkgJson.scripts as Record<string, string> | undefined
	const scriptNames = scripts && typeof scripts === 'object' ? Object.keys(scripts) : []
	const pm = detectPackageManager(pkgJson, dir)

	const expanded: Record<string, NumuxProcessConfig | string> = {}

	for (const [name, value] of entries) {
		if (!isScriptReference(name, value)) {
			// true/null shorthand: resolve from scripts or pass through for validator to catch
			if (value === true || value == null) {
				expanded[name] = scriptNames.includes(name) ? expandScriptCommand(name, pm) : (value as any)
				continue
			}
			let proc = value as NumuxProcessConfig | string
			const c = cmd(proc)
			if (typeof c === 'string' && c.startsWith('npm:')) {
				const expandedCmd = expandScriptCommand(c.slice(4), pm)
				proc = typeof proc === 'string' ? expandedCmd : { ...proc, command: expandedCmd }
			} else if (!c && scriptNames.includes(name)) {
				// Auto-resolve: process name matches a package.json script
				proc = { ...(proc as NumuxProcessConfig), command: expandScriptCommand(name, pm) }
			}
			expanded[name] = proc
			continue
		}

		if (!scripts || typeof scripts !== 'object') {
			throw new Error('package.json has no "scripts" field')
		}

		const rawPattern = name.startsWith('npm:') ? name.slice(4) : name
		const { glob: globPattern, extraArgs } = splitPatternArgs(rawPattern)
		const template = (value ?? {}) as Partial<NumuxProcessConfig>

		if (template.command) {
			throw new Error(
				`"${name}": wildcard processes cannot have a "command" field (commands come from package.json scripts)`
			)
		}

		const leafOnly = globPattern.endsWith('^')
		const effectivePattern = leafOnly ? globPattern.slice(0, -1) : globPattern
		const glob = new Bun.Glob(effectivePattern)
		const colonDepth = (effectivePattern.match(/:/g) || []).length
		const matches = scriptNames.filter(
			s =>
				glob.match(s) &&
				(s.match(/:/g) || []).length === colonDepth &&
				!(leafOnly && scriptNames.some(other => other.startsWith(`${s}:`)))
		)

		if (matches.length === 0) {
			throw new Error(
				`"${name}": no scripts matched pattern "${effectivePattern}". Available scripts: ${scriptNames.join(', ')}`
			)
		}

		const colors = Array.isArray(template.color) ? template.color : undefined
		const singleColor = typeof template.color === 'string' ? template.color : undefined

		for (let i = 0; i < matches.length; i++) {
			const scriptName = matches[i]
			const displayName = deriveShortName(effectivePattern, scriptName)

			if (expanded[displayName]) {
				throw new Error(`"${name}": expanded script "${scriptName}" collides with an existing process name`)
			}

			const color = colors ? colors[i % colors.length] : singleColor

			const { color: _color, ...rest } = template
			expanded[displayName] = {
				...rest,
				command: expandScriptCommand(`${scriptName}${extraArgs}`, pm),
				...(color ? { color } : {})
			} as NumuxProcessConfig
		}
	}

	return { ...config, processes: expanded }
}
