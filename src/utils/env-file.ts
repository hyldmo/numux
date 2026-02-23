import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** Parse a .env file into key-value pairs. Supports comments, quotes, and empty lines. */
export function parseEnvFile(content: string): Record<string, string> {
	const vars: Record<string, string> = {}

	for (const line of content.split('\n')) {
		const trimmed = line.trim()
		if (!trimmed || trimmed.startsWith('#')) continue

		const eqIndex = trimmed.indexOf('=')
		if (eqIndex < 1) continue

		const key = trimmed.slice(0, eqIndex).trim()
		let value = trimmed.slice(eqIndex + 1).trim()

		// Strip surrounding quotes
		if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
			value = value.slice(1, -1)
		}

		vars[key] = value
	}

	return vars
}

/** Load one or more .env files and merge them into a single Record. Later files override earlier ones. */
export function loadEnvFiles(envFile: string | string[], cwd: string): Record<string, string> {
	const files = Array.isArray(envFile) ? envFile : [envFile]
	const merged: Record<string, string> = {}

	for (const file of files) {
		const path = resolve(cwd, file)
		let content: string
		try {
			content = readFileSync(path, 'utf-8')
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code
			if (code === 'ENOENT') {
				throw new Error(`envFile not found: ${path}`)
			}
			throw new Error(`Failed to read envFile "${path}": ${err instanceof Error ? err.message : err}`)
		}
		Object.assign(merged, parseEnvFile(content))
	}

	return merged
}
