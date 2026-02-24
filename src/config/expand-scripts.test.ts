import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { detectPackageManager, expandScriptPatterns } from './expand-scripts'

const TMP = join(import.meta.dir, '../../.tmp-expand-test')

beforeAll(() => {
	mkdirSync(TMP, { recursive: true })
})

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true })
})

function setupDir(name: string, files: Record<string, string>): string {
	const dir = join(TMP, name)
	mkdirSync(dir, { recursive: true })
	for (const [file, content] of Object.entries(files)) {
		writeFileSync(join(dir, file), content)
	}
	return dir
}

function pkgJson(scripts: Record<string, string>, extra?: Record<string, unknown>): string {
	return JSON.stringify({ scripts, ...extra })
}

describe('expandScriptPatterns', () => {
	test('no wildcards — passthrough', () => {
		const config = { processes: { web: 'echo hi' } }
		expect(expandScriptPatterns(config)).toBe(config)
	})

	test('basic expansion matches scripts', () => {
		const dir = setupDir('basic', {
			'package.json': pkgJson({
				'store:dev': 'next dev',
				'api:dev': 'bun run api',
				build: 'tsc'
			})
		})
		const result = expandScriptPatterns({ processes: { 'npm:*:dev': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'store'])
		expect((result.processes.store as { command: string }).command).toBe('npm run store:dev')
		expect((result.processes.api as { command: string }).command).toBe('npm run api:dev')
	})

	test('template properties are inherited', () => {
		const dir = setupDir('template', {
			'package.json': pkgJson({ 'app:dev': 'next dev', 'api:dev': 'bun api' })
		})
		const result = expandScriptPatterns(
			{
				processes: {
					'npm:*:dev': { env: { NODE_ENV: 'dev' }, dependsOn: ['db'] } as any
				}
			},
			dir
		)
		const proc = result.processes.app as any
		expect(proc.env).toEqual({ NODE_ENV: 'dev' })
		expect(proc.dependsOn).toEqual(['db'])
	})

	test('color array distributes round-robin', () => {
		const dir = setupDir('colors', {
			'package.json': pkgJson({ 'a:dev': 'a', 'b:dev': 'b', 'c:dev': 'c' })
		})
		const result = expandScriptPatterns(
			{
				processes: {
					'npm:*:dev': { color: ['#ff0000', '#00ff00'] } as any
				}
			},
			dir
		)
		expect((result.processes.a as any).color).toBe('#ff0000')
		expect((result.processes.b as any).color).toBe('#00ff00')
		expect((result.processes.c as any).color).toBe('#ff0000')
	})

	test('single color string shared by all', () => {
		const dir = setupDir('single-color', {
			'package.json': pkgJson({ 'a:dev': 'a', 'b:dev': 'b' })
		})
		const result = expandScriptPatterns(
			{
				processes: {
					'npm:*:dev': { color: '#ff0000' } as any
				}
			},
			dir
		)
		expect((result.processes.a as any).color).toBe('#ff0000')
		expect((result.processes.b as any).color).toBe('#ff0000')
	})

	test('no color — omitted from expanded processes', () => {
		const dir = setupDir('no-color', {
			'package.json': pkgJson({ 'a:dev': 'a' })
		})
		const result = expandScriptPatterns({ processes: { 'npm:*:dev': {} } }, dir)
		expect((result.processes.a as any).color).toBeUndefined()
	})

	test('mixed config preserves regular processes', () => {
		const dir = setupDir('mixed', {
			'package.json': pkgJson({ 'app:dev': 'next dev' })
		})
		const result = expandScriptPatterns(
			{
				processes: {
					db: 'docker compose up',
					'npm:*:dev': {}
				}
			},
			dir
		)
		expect(result.processes.db).toBe('docker compose up')
		expect((result.processes.app as any).command).toBe('npm run app:dev')
	})

	test('collision with existing process throws', () => {
		const dir = setupDir('collision', {
			'package.json': pkgJson({ web: 'next dev' })
		})
		expect(() =>
			expandScriptPatterns(
				{
					processes: {
						web: 'echo hi',
						'npm:web': {}
					}
				},
				dir
			)
		).toThrow('collides')
	})

	test('no matches throws with available scripts', () => {
		const dir = setupDir('no-match', {
			'package.json': pkgJson({ build: 'tsc', lint: 'eslint' })
		})
		expect(() => expandScriptPatterns({ processes: { 'npm:*:dev': {} } }, dir)).toThrow(
			/no scripts matched.*Available scripts/
		)
	})

	test('no package.json throws', () => {
		const dir = setupDir('no-pkg', {})
		expect(() => expandScriptPatterns({ processes: { 'npm:*': {} } }, dir)).toThrow('package.json')
	})

	test('no scripts field throws', () => {
		const dir = setupDir('no-scripts', {
			'package.json': JSON.stringify({ name: 'test' })
		})
		expect(() => expandScriptPatterns({ processes: { 'npm:*': {} } }, dir)).toThrow('no "scripts" field')
	})

	test('command on wildcard throws', () => {
		const dir = setupDir('cmd-err', {
			'package.json': pkgJson({ dev: 'next dev' })
		})
		expect(() => expandScriptPatterns({ processes: { 'npm:dev': { command: 'override' } as any } }, dir)).toThrow(
			'cannot have a "command"'
		)
	})

	test('null value treated as empty template', () => {
		const dir = setupDir('null-val', {
			'package.json': pkgJson({ dev: 'next dev' })
		})
		const result = expandScriptPatterns({ processes: { 'npm:dev': null as any } }, dir)
		expect((result.processes.dev as any).command).toBe('npm run dev')
	})

	test('multiple wildcards with distinct short names', () => {
		const dir = setupDir('multi-wild', {
			'package.json': pkgJson({
				'dev:web': 'next dev',
				'dev:api': 'bun api',
				'test:unit': 'vitest',
				'test:e2e': 'playwright'
			})
		})
		const result = expandScriptPatterns(
			{
				processes: {
					'npm:dev:*': {},
					'npm:test:*': {}
				}
			},
			dir
		)
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'e2e', 'unit', 'web'])
	})

	test('multiple wildcards with colliding short names throws', () => {
		const dir = setupDir('multi-wild-collision', {
			'package.json': pkgJson({
				'store:dev': 'next dev',
				'api:dev': 'bun api',
				'store:build': 'next build',
				'api:build': 'tsc'
			})
		})
		expect(() =>
			expandScriptPatterns(
				{
					processes: {
						'npm:*:dev': {},
						'npm:*:build': {}
					}
				},
				dir
			)
		).toThrow('collides')
	})

	test('complex glob pattern', () => {
		const dir = setupDir('complex-glob', {
			'package.json': pkgJson({
				'app-web': 'next dev',
				'app-api': 'bun api',
				'lib-core': 'tsc'
			})
		})
		const result = expandScriptPatterns({ processes: { 'npm:app-*': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'web'])
		expect(result.processes['lib-core']).toBeUndefined()
	})

	test('uses config cwd for package.json lookup', () => {
		const dir = setupDir('cwd-lookup', {
			'package.json': pkgJson({ dev: 'next dev' })
		})
		const result = expandScriptPatterns({ cwd: dir, processes: { 'npm:dev': {} } })
		expect((result.processes.dev as any).command).toBe('npm run dev')
	})

	test('bare glob pattern expands like npm: prefix', () => {
		const dir = setupDir('bare-glob', {
			'package.json': pkgJson({
				'store:dev': 'next dev',
				'api:dev': 'bun run api',
				build: 'tsc'
			})
		})
		const result = expandScriptPatterns({ processes: { '*:dev': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'store'])
		expect((result.processes.store as { command: string }).command).toBe('npm run store:dev')
		expect((result.processes.api as { command: string }).command).toBe('npm run api:dev')
	})

	test('bare glob with template properties', () => {
		const dir = setupDir('bare-glob-template', {
			'package.json': pkgJson({ 'app:dev': 'next dev', 'api:dev': 'bun api' })
		})
		const result = expandScriptPatterns(
			{
				processes: {
					'*:dev': { env: { NODE_ENV: 'dev' }, dependsOn: ['db'] } as any
				}
			},
			dir
		)
		const proc = result.processes.app as any
		expect(proc.env).toEqual({ NODE_ENV: 'dev' })
		expect(proc.dependsOn).toEqual(['db'])
		expect(proc.command).toBe('npm run app:dev')
	})

	test('bare glob with color array', () => {
		const dir = setupDir('bare-glob-colors', {
			'package.json': pkgJson({ 'a:dev': 'a', 'b:dev': 'b', 'c:dev': 'c' })
		})
		const result = expandScriptPatterns(
			{
				processes: {
					'*:dev': { color: ['#ff0000', '#00ff00'] } as any
				}
			},
			dir
		)
		expect((result.processes.a as any).color).toBe('#ff0000')
		expect((result.processes.b as any).color).toBe('#00ff00')
		expect((result.processes.c as any).color).toBe('#ff0000')
	})

	test('bare glob mixed with regular processes', () => {
		const dir = setupDir('bare-glob-mixed', {
			'package.json': pkgJson({ 'app:dev': 'next dev' })
		})
		const result = expandScriptPatterns(
			{
				processes: {
					db: 'docker compose up',
					'*:dev': {}
				}
			},
			dir
		)
		expect(result.processes.db).toBe('docker compose up')
		expect((result.processes.app as any).command).toBe('npm run app:dev')
	})

	test('bare glob no matches throws with available scripts', () => {
		const dir = setupDir('bare-glob-no-match', {
			'package.json': pkgJson({ build: 'tsc', lint: 'eslint' })
		})
		expect(() => expandScriptPatterns({ processes: { '*:dev': {} } }, dir)).toThrow(
			/no scripts matched.*Available scripts/
		)
	})

	test('bare glob collision with existing process throws', () => {
		const dir = setupDir('bare-glob-collision', {
			'package.json': pkgJson({ 'dev:web': 'next dev' })
		})
		expect(() =>
			expandScriptPatterns(
				{
					processes: {
						web: 'echo hi',
						'dev:*': {}
					}
				},
				dir
			)
		).toThrow('collides')
	})

	test('bare glob with question mark pattern', () => {
		const dir = setupDir('bare-glob-question', {
			'package.json': pkgJson({ 'a1': 'cmd1', 'a2': 'cmd2', 'ab': 'cmd3' })
		})
		const result = expandScriptPatterns({ processes: { 'a?': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['1', '2', 'b'])
	})

	test('bare glob command on wildcard throws', () => {
		const dir = setupDir('bare-glob-cmd-err', {
			'package.json': pkgJson({ dev: 'next dev' })
		})
		expect(() => expandScriptPatterns({ processes: { '*ev': { command: 'override' } as any } }, dir)).toThrow(
			'cannot have a "command"'
		)
	})

	test('non-glob names without command are not expanded', () => {
		// Names like "web" that don't contain glob chars should NOT be treated as patterns
		const config = { processes: { web: { env: { FOO: 'bar' } } as any } }
		// This should passthrough, not try to expand
		expect(expandScriptPatterns(config)).toBe(config)
	})

	test('extra args are forwarded to expanded commands', () => {
		const dir = setupDir('args-basic', {
			'package.json': pkgJson({ 'lint:js': 'eslint', 'lint:ts': 'tsc' })
		})
		const result = expandScriptPatterns({ processes: { 'lint:* --fix': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['js', 'ts'])
		expect((result.processes.js as any).command).toBe('npm run lint:js --fix')
		expect((result.processes.ts as any).command).toBe('npm run lint:ts --fix')
	})

	test('npm: prefix with extra args', () => {
		const dir = setupDir('args-npm-prefix', {
			'package.json': pkgJson({ 'lint:js': 'eslint', 'lint:ts': 'tsc' })
		})
		const result = expandScriptPatterns({ processes: { 'npm:lint:* --fix': {} } }, dir)
		expect((result.processes.js as any).command).toBe('npm run lint:js --fix')
		expect((result.processes.ts as any).command).toBe('npm run lint:ts --fix')
	})

	test('multiple extra args forwarded', () => {
		const dir = setupDir('args-multi', {
			'package.json': pkgJson({ 'lint:js': 'eslint' })
		})
		const result = expandScriptPatterns({ processes: { 'lint:* --fix --quiet': {} } }, dir)
		expect((result.processes.js as any).command).toBe('npm run lint:js --fix --quiet')
	})

	test('npm: exact script name with extra args', () => {
		const dir = setupDir('args-exact', {
			'package.json': pkgJson({ lint: 'eslint' })
		})
		const result = expandScriptPatterns({ processes: { 'npm:lint --fix': {} } }, dir)
		expect((result.processes.lint as any).command).toBe('npm run lint --fix')
	})

	test('prefix glob strips common prefix from process names', () => {
		// numux 'dev:*' should produce tab names "web", "api", "db" not "dev:web", etc.
		const dir = setupDir('prefix-strip', {
			'package.json': pkgJson({
				'dev:web': 'vite',
				'dev:api': 'bun run api',
				'dev:db': 'bun run db'
			})
		})
		const result = expandScriptPatterns({ processes: { 'dev:*': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'db', 'web'])
		// Commands must still reference full script name
		expect((result.processes.web as any).command).toBe('npm run dev:web')
		expect((result.processes.api as any).command).toBe('npm run dev:api')
		expect((result.processes.db as any).command).toBe('npm run dev:db')
	})

	test('suffix glob strips common suffix from process names', () => {
		const dir = setupDir('suffix-strip', {
			'package.json': pkgJson({
				'store:dev': 'next dev',
				'api:dev': 'bun run api'
			})
		})
		const result = expandScriptPatterns({ processes: { '*:dev': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['api', 'store'])
		expect((result.processes.store as any).command).toBe('npm run store:dev')
		expect((result.processes.api as any).command).toBe('npm run api:dev')
	})

	test('fully-wildcard pattern keeps full script name', () => {
		const dir = setupDir('full-wild', {
			'package.json': pkgJson({ dev: 'vite', build: 'tsc' })
		})
		const result = expandScriptPatterns({ processes: { '*': {} } }, dir)
		expect(Object.keys(result.processes).sort()).toEqual(['build', 'dev'])
	})

	test('bare glob from CLI-style usage does not match non-colon scripts', () => {
		// Simulates: numux '*:dev' — should only match scripts containing ":dev"
		const dir = setupDir('cli-bare-glob', {
			'package.json': pkgJson({
				dev: "numux '*:dev'",
				'store:dev': 'next dev --port 3001',
				'api:dev': 'bun run src/api.ts',
				build: 'tsc',
				lint: 'biome check'
			})
		})
		const result = expandScriptPatterns({ processes: { '*:dev': { color: ['#00ff00', '#00ffff'] } as any } }, dir)
		const names = Object.keys(result.processes).sort()
		expect(names).toEqual(['api', 'store'])
		// "dev" script should NOT match *:dev (no colon)
		expect(result.processes.dev).toBeUndefined()
	})
})

describe('detectPackageManager', () => {
	test('reads packageManager field', () => {
		const dir = setupDir('pm-field', {
			'package.json': '{}'
		})
		expect(detectPackageManager({ packageManager: 'yarn@4.0.0' }, dir)).toBe('yarn')
		expect(detectPackageManager({ packageManager: 'pnpm@8.0.0' }, dir)).toBe('pnpm')
		expect(detectPackageManager({ packageManager: 'bun@1.0.0' }, dir)).toBe('bun')
	})

	test('detects from bun.lockb', () => {
		const dir = setupDir('pm-bun', {
			'bun.lockb': ''
		})
		expect(detectPackageManager({}, dir)).toBe('bun')
	})

	test('detects from yarn.lock', () => {
		const dir = setupDir('pm-yarn', {
			'yarn.lock': ''
		})
		expect(detectPackageManager({}, dir)).toBe('yarn')
	})

	test('detects from pnpm-lock.yaml', () => {
		const dir = setupDir('pm-pnpm', {
			'pnpm-lock.yaml': ''
		})
		expect(detectPackageManager({}, dir)).toBe('pnpm')
	})

	test('detects from package-lock.json', () => {
		const dir = setupDir('pm-npm', {
			'package-lock.json': '{}'
		})
		expect(detectPackageManager({}, dir)).toBe('npm')
	})

	test('packageManager field takes priority over lockfile', () => {
		const dir = setupDir('pm-priority', {
			'yarn.lock': ''
		})
		expect(detectPackageManager({ packageManager: 'bun@1.0.0' }, dir)).toBe('bun')
	})

	test('defaults to npm when nothing found', () => {
		const dir = setupDir('pm-default', {
			'package.json': '{}'
		})
		expect(detectPackageManager({}, dir)).toBe('npm')
	})
})
