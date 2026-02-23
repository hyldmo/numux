import { existsSync, readFileSync } from 'node:fs'
import { extname, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { NumuxConfig } from '../types'
import { log } from '../utils/logger'

const CONFIG_FILES = [
	'numux.config.ts',
	'numux.config.js',
	'numux.config.yaml',
	'numux.config.yml',
	'numux.config.json'
] as const

export async function loadConfig(configPath?: string, cwd?: string): Promise<NumuxConfig> {
	if (configPath) {
		return loadExplicitConfig(configPath)
	}
	return autoDetectConfig(cwd ?? process.cwd())
}

async function loadFile(path: string): Promise<NumuxConfig> {
	const ext = extname(path)
	if (ext === '.yaml' || ext === '.yml') {
		const content = readFileSync(path, 'utf-8')
		try {
			return parseYaml(content) as NumuxConfig
		} catch (err) {
			throw new Error(`Failed to parse ${path}: ${err instanceof Error ? err.message : err}`, { cause: err })
		}
	}
	const mod = await import(path)
	return mod.default ?? mod
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
