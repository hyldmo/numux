import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadConfig } from './loader'

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
	test('loads a .json config by explicit path', async () => {
		const dir = setupDir('explicit-json', {
			'custom.json': JSON.stringify({
				processes: { web: { command: 'echo hi' } }
			})
		})
		const config = await loadConfig(join(dir, 'custom.json'))
		expect(config.processes.web.command).toBe('echo hi')
	})

	test('loads a config with a custom name', async () => {
		const dir = setupDir('explicit-custom', {
			'my-numux.json': JSON.stringify({
				processes: { api: { command: 'echo api' } }
			})
		})
		const config = await loadConfig(join(dir, 'my-numux.json'))
		expect(config.processes.api.command).toBe('echo api')
	})

	test('loads a .ts config with default export', async () => {
		const dir = setupDir('ts-default', {
			'config.ts': `export default { processes: { app: { command: 'echo app' } } }`
		})
		const config = await loadConfig(join(dir, 'config.ts'))
		expect(config.processes.app.command).toBe('echo app')
	})

	test('loads a .js config with default export', async () => {
		const dir = setupDir('js-default', {
			'config.js': `export default { processes: { worker: { command: 'echo worker' } } }`
		})
		const config = await loadConfig(join(dir, 'config.js'))
		expect(config.processes.worker.command).toBe('echo worker')
	})

	test('throws when explicit path does not exist', async () => {
		await expect(loadConfig('/nonexistent/path/config.json')).rejects.toThrow('Config file not found')
	})

	test('explicit path takes precedence over auto-detect', async () => {
		const dir = setupDir('explicit-precedence', {
			'numux.config.json': JSON.stringify({
				processes: { auto: { command: 'echo auto' } }
			}),
			'custom.json': JSON.stringify({
				processes: { custom: { command: 'echo custom' } }
			})
		})
		const config = await loadConfig(join(dir, 'custom.json'), dir)
		expect(config.processes.custom).toBeDefined()
		expect(config.processes.auto).toBeUndefined()
	})
})

describe('loadConfig — auto-detect', () => {
	test('auto-detects numux.config.json', async () => {
		const dir = setupDir('auto-json', {
			'numux.config.json': JSON.stringify({
				processes: { db: { command: 'echo db' } }
			})
		})
		const config = await loadConfig(undefined, dir)
		expect(config.processes.db.command).toBe('echo db')
	})

	test('auto-detects numux.config.ts', async () => {
		const dir = setupDir('auto-ts', {
			'numux.config.ts': `export default { processes: { api: { command: 'echo api' } } }`
		})
		const config = await loadConfig(undefined, dir)
		expect(config.processes.api.command).toBe('echo api')
	})

	test('auto-detects numux.config.js', async () => {
		const dir = setupDir('auto-js', {
			'numux.config.js': `export default { processes: { web: { command: 'echo web' } } }`
		})
		const config = await loadConfig(undefined, dir)
		expect(config.processes.web.command).toBe('echo web')
	})

	test('prefers numux.config.ts over .js and .json', async () => {
		const dir = setupDir('auto-priority', {
			'numux.config.ts': `export default { processes: { ts: { command: 'echo ts' } } }`,
			'numux.config.js': `export default { processes: { js: { command: 'echo js' } } }`,
			'numux.config.json': JSON.stringify({ processes: { json: { command: 'echo json' } } })
		})
		const config = await loadConfig(undefined, dir)
		expect(config.processes.ts).toBeDefined()
	})

	test('falls back to package.json "numux" key', async () => {
		const dir = setupDir('auto-pkg', {
			'package.json': JSON.stringify({
				name: 'test-project',
				numux: {
					processes: { svc: { command: 'echo svc' } }
				}
			})
		})
		const config = await loadConfig(undefined, dir)
		expect(config.processes.svc.command).toBe('echo svc')
	})

	test('ignores package.json without "numux" key', async () => {
		const dir = setupDir('auto-pkg-no-numux', {
			'package.json': JSON.stringify({ name: 'test-project' })
		})
		await expect(loadConfig(undefined, dir)).rejects.toThrow('No numux config found')
	})

	test('throws when no config is found (empty dir)', async () => {
		const dir = setupDir('empty', {})
		await expect(loadConfig(undefined, dir)).rejects.toThrow('No numux config found')
	})
})
