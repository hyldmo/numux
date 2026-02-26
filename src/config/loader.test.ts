import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NumuxConfig, NumuxProcessConfig } from '../types'
import { loadConfig } from './loader'

/** Helper to cast raw process config to the full object type (for test assertions on loader output) */
const proc = (p: NumuxConfig['processes'][string]) => p as NumuxProcessConfig

const TMP = join(import.meta.dir, '../../.tmp-loader-test')

beforeAll(() => {
	mkdirSync(TMP, { recursive: true })
})

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true })
})

/** Create a temp subdirectory with files and return its path */
function setupDir(name: string, files: Record<string, string>): string {
	const dir = join(TMP, name)
	mkdirSync(dir, { recursive: true })
	for (const [file, content] of Object.entries(files)) {
		writeFileSync(join(dir, file), content)
	}
	return dir
}

describe('loadConfig — explicit path', () => {
	test('loads a .ts config with default export', async () => {
		const dir = setupDir('ts-default', {
			'config.ts': `export default { processes: { app: { command: 'echo app' } } }`
		})
		const config = await loadConfig(join(dir, 'config.ts'))
		expect(proc(config.processes.app).command).toBe('echo app')
	})

	test('loads a .js config with default export', async () => {
		const dir = setupDir('js-default', {
			'config.js': `export default { processes: { worker: { command: 'echo worker' } } }`
		})
		const config = await loadConfig(join(dir, 'config.js'))
		expect(proc(config.processes.worker).command).toBe('echo worker')
	})

	test('throws when explicit path does not exist', async () => {
		await expect(loadConfig('/nonexistent/path/config.ts')).rejects.toThrow('Config file not found')
	})

	test('explicit path takes precedence over auto-detect', async () => {
		const dir = setupDir('explicit-precedence', {
			'numux.config.ts': `export default { processes: { auto: { command: 'echo auto' } } }`,
			'custom.ts': `export default { processes: { custom: { command: 'echo custom' } } }`
		})
		const config = await loadConfig(join(dir, 'custom.ts'), dir)
		expect(config.processes.custom).toBeDefined()
		expect(config.processes.auto).toBeUndefined()
	})
})

describe('loadConfig — auto-detect', () => {
	test('auto-detects numux.config.ts', async () => {
		const dir = setupDir('auto-ts', {
			'numux.config.ts': `export default { processes: { api: { command: 'echo api' } } }`
		})
		const config = await loadConfig(undefined, dir)
		expect(proc(config.processes.api).command).toBe('echo api')
	})

	test('auto-detects numux.config.js', async () => {
		const dir = setupDir('auto-js', {
			'numux.config.js': `export default { processes: { web: { command: 'echo web' } } }`
		})
		const config = await loadConfig(undefined, dir)
		expect(proc(config.processes.web).command).toBe('echo web')
	})

	test('prefers numux.config.ts over .js', async () => {
		const dir = setupDir('auto-priority', {
			'numux.config.ts': `export default { processes: { ts: { command: 'echo ts' } } }`,
			'numux.config.js': `export default { processes: { js: { command: 'echo js' } } }`
		})
		const config = await loadConfig(undefined, dir)
		expect(config.processes.ts).toBeDefined()
	})

	test('throws when no config is found (empty dir)', async () => {
		const dir = setupDir('empty', {})
		await expect(loadConfig(undefined, dir)).rejects.toThrow('No numux config found')
	})
})

describe('loadConfig — package.json', () => {
	test('auto-detects numux config from package.json', async () => {
		const dir = setupDir('pkg-json', {
			'package.json': JSON.stringify({
				name: 'test',
				numux: { processes: { db: { command: 'echo db' } } }
			})
		})
		const config = await loadConfig(undefined, dir)
		expect(proc(config.processes.db).command).toBe('echo db')
	})

	test('numux.config.ts takes precedence over package.json', async () => {
		const dir = setupDir('pkg-json-precedence', {
			'numux.config.ts': `export default { processes: { ts: { command: 'echo ts' } } }`,
			'package.json': JSON.stringify({
				name: 'test',
				numux: { processes: { pkg: { command: 'echo pkg' } } }
			})
		})
		const config = await loadConfig(undefined, dir)
		expect(config.processes.ts).toBeDefined()
		expect(config.processes.pkg).toBeUndefined()
	})

	test('ignores package.json without numux key', async () => {
		const dir = setupDir('pkg-json-no-key', {
			'package.json': JSON.stringify({ name: 'test', scripts: { dev: 'echo dev' } })
		})
		await expect(loadConfig(undefined, dir)).rejects.toThrow('No numux config found')
	})
})
