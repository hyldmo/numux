import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NumuxConfig } from '../types'
import { log } from '../utils/logger'

const CONFIG_FILES = ['numux.config.ts', 'numux.config.js', 'numux.config.json'] as const

export async function loadConfig(pathOrCwd?: string): Promise<NumuxConfig> {
	// Explicit config file path
	if (pathOrCwd && (pathOrCwd.endsWith('.ts') || pathOrCwd.endsWith('.js') || pathOrCwd.endsWith('.json'))) {
		const path = resolve(pathOrCwd)
		if (!existsSync(path)) {
			throw new Error(`Config file not found: ${path}`)
		}
		log(`Loading explicit config: ${path}`)
		const mod = await import(path)
		return mod.default ?? mod
	}

	const cwd = pathOrCwd ?? process.cwd()

	// Try dedicated config files first
	for (const file of CONFIG_FILES) {
		const path = resolve(cwd, file)
		if (existsSync(path)) {
			log(`Found config file: ${path}`)
			const mod = await import(path)
			return mod.default ?? mod
		}
	}

	// Try package.json "numux" key
	const pkgPath = resolve(cwd, 'package.json')
	if (existsSync(pkgPath)) {
		const pkg = await import(pkgPath)
		const config = (pkg.default ?? pkg).numux
		if (config) {
			log('Found config in package.json "numux" key')
			return config as NumuxConfig
		}
	}

	throw new Error(
		`No numux config found. Create one of: ${CONFIG_FILES.join(', ')} or add a "numux" key to package.json`
	)
}
