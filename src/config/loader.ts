import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import type { NumuxConfig } from '../types'
import { log } from '../utils/logger'
import { interpolateConfig } from './interpolate'

const CONFIG_FILES = ['numux.config.ts', 'numux.config.js'] as const

export async function loadConfig(configPath?: string, cwd?: string): Promise<NumuxConfig> {
	if (configPath) {
		return loadExplicitConfig(resolve(configPath))
	}
	return autoDetectConfig(cwd ?? process.cwd())
}

/** Resolve the config file path without loading it. Returns null if no config file is found. */
export function resolveConfigPath(configPath?: string, cwd?: string): string | null {
	if (configPath) {
		const path = resolve(configPath)
		return existsSync(path) ? path : null
	}
	for (const file of CONFIG_FILES) {
		const path = resolve(cwd ?? process.cwd(), file)
		if (existsSync(path)) return path
	}
	return null
}

async function loadFile(path: string): Promise<NumuxConfig> {
	try {
		const mod = await import(`${path}?t=${Date.now()}`)
		return interpolateConfig(mod.default ?? mod)
	} catch (err) {
		throw new Error(`Failed to load ${path}: ${err instanceof Error ? err.message : err}`, { cause: err })
	}
}

async function loadExplicitConfig(path: string): Promise<NumuxConfig> {
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

	throw new Error(`No numux config found. Create one of: ${CONFIG_FILES.join(', ')}`)
}
