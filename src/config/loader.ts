import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NumuxConfig } from '../types'
import { log } from '../utils/logger'
import { interpolateConfig } from './interpolate'

const CONFIG_FILES = ['numux.config.ts', 'numux.config.js'] as const

export async function loadConfig(configPath?: string, cwd?: string): Promise<NumuxConfig> {
	if (configPath) {
		return loadExplicitConfig(configPath)
	}
	return autoDetectConfig(cwd ?? process.cwd())
}

async function loadFile(path: string): Promise<NumuxConfig> {
	try {
		const mod = await import(path)
		return interpolateConfig(mod.default ?? mod)
	} catch (err) {
		throw new Error(`Failed to load ${path}: ${err instanceof Error ? err.message : err}`, { cause: err })
	}
}

async function loadExplicitConfig(configPath: string): Promise<NumuxConfig> {
	const path = resolve(configPath)
	if (!existsSync(path)) {
		throw new Error(`Config file not found: ${path}`)
	}
	log(`Loading explicit config: ${path}`)
	return loadFile(path)
}

async function autoDetectConfig(cwd: string): Promise<NumuxConfig> {
	for (const file of CONFIG_FILES) {
		const path = resolve(cwd, file)
		if (existsSync(path)) {
			log(`Found config file: ${path}`)
			return loadFile(path)
		}
	}

	const pkgPath = resolve(cwd, 'package.json')
	if (existsSync(pkgPath)) {
		const pkgJson = JSON.parse(readFileSync(pkgPath, 'utf-8')) as Record<string, unknown>
		if (pkgJson.numux && typeof pkgJson.numux === 'object') {
			log(`Found numux config in package.json`)
			return interpolateConfig(pkgJson.numux as NumuxConfig)
		}
	}

	throw new Error(
		`No numux config found. Create one of: ${CONFIG_FILES.join(', ')}, or add a "numux" key to package.json`
	)
}
