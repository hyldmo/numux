import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NumuxConfig } from '../types'

const CONFIG_FILES = ['numux.config.ts', 'numux.config.js', 'numux.config.json'] as const

export async function loadConfig(cwd: string = process.cwd()): Promise<NumuxConfig> {
	// Try dedicated config files first
	for (const file of CONFIG_FILES) {
		const path = resolve(cwd, file)
		if (existsSync(path)) {
			const mod = await import(path)
			return mod.default ?? mod
		}
	}

	// Try package.json "numux" key
	const pkgPath = resolve(cwd, 'package.json')
	if (existsSync(pkgPath)) {
		const pkg = await import(pkgPath)
		const config = (pkg.default ?? pkg).numux
		if (config) return config as NumuxConfig
	}

	throw new Error(
		`No numux config found. Create one of: ${CONFIG_FILES.join(', ')} or add a "numux" key to package.json`
	)
}
