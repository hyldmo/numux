import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { resolveWorkspaceProcesses } from './workspaces'

const TMP = join(import.meta.dir, '../../.tmp-workspace-test')

beforeAll(() => {
	mkdirSync(TMP, { recursive: true })
})

afterAll(() => {
	rmSync(TMP, { recursive: true, force: true })
})

function setupMonorepo(
	name: string,
	opts: {
		rootPkg: Record<string, unknown>
		workspaces: Record<string, Record<string, unknown>>
		rootFiles?: Record<string, string>
	}
): string {
	const dir = join(TMP, name)
	mkdirSync(dir, { recursive: true })

	// Write root package.json
	writeFileSync(join(dir, 'package.json'), JSON.stringify(opts.rootPkg))

	// Write extra root files (lockfiles, etc)
	if (opts.rootFiles) {
		for (const [file, content] of Object.entries(opts.rootFiles)) {
			writeFileSync(join(dir, file), content)
		}
	}

	// Write workspace package.jsons
	for (const [wsPath, pkg] of Object.entries(opts.workspaces)) {
		const wsDir = join(dir, wsPath)
		mkdirSync(wsDir, { recursive: true })
		writeFileSync(join(wsDir, 'package.json'), JSON.stringify(pkg))
	}

	return dir
}

describe('resolveWorkspaceProcesses', () => {
	test('array workspace format', () => {
		const dir = setupMonorepo('array-format', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { dev: 'next dev' } },
				'packages/api': { name: 'api', scripts: { dev: 'bun run api' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(Object.keys(result).sort()).toEqual(['api', 'web'])
		expect(result.web.command).toBe('npm run dev')
		expect(result.web.persistent).toBe(true)
		expect(result.web.cwd).toBe(join(dir, 'packages/web'))
	})

	test('Yarn v1 object workspace format', () => {
		const dir = setupMonorepo('yarn-format', {
			rootPkg: { workspaces: { packages: ['packages/*'] } },
			workspaces: {
				'packages/app': { name: 'app', scripts: { dev: 'next dev' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(Object.keys(result)).toEqual(['app'])
	})

	test('package name used as process name', () => {
		const dir = setupMonorepo('pkg-name', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/my-app': { name: 'my-app', scripts: { dev: 'next dev' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(Object.keys(result)).toEqual(['my-app'])
	})

	test('directory basename fallback when no name', () => {
		const dir = setupMonorepo('no-name', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/frontend': { scripts: { dev: 'next dev' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(Object.keys(result)).toEqual(['frontend'])
	})

	test('scoped name stripping', () => {
		const dir = setupMonorepo('scoped', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/core': { name: '@myorg/core', scripts: { dev: 'tsc -w' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(Object.keys(result)).toEqual(['core'])
	})

	test('name dedup on collision', () => {
		const dir = setupMonorepo('dedup', {
			rootPkg: { workspaces: ['apps/*', 'libs/*'] },
			workspaces: {
				'apps/core': { name: 'core', scripts: { dev: 'next dev' } },
				'libs/core': { name: 'core', scripts: { dev: 'tsc -w' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		const names = Object.keys(result).sort()
		expect(names).toEqual(['core', 'core-1'])
	})

	test('silent skip for missing script', () => {
		const dir = setupMonorepo('skip-missing-script', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { dev: 'next dev' } },
				'packages/utils': { name: 'utils', scripts: { build: 'tsc' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(Object.keys(result)).toEqual(['web'])
	})

	test('silent skip for missing package.json in glob match', () => {
		const dir = setupMonorepo('skip-no-pkg', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { dev: 'next dev' } }
			}
		})
		// Create a directory without package.json
		mkdirSync(join(dir, 'packages/empty'), { recursive: true })
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(Object.keys(result)).toEqual(['web'])
	})

	test('error when no script and not a built-in command', () => {
		const dir = setupMonorepo('no-match', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { build: 'tsc' } }
			}
		})
		expect(() => resolveWorkspaceProcesses('xyznotacommand', dir)).toThrow('is not a built-in npm command')
	})

	test('built-in PM command runs in all workspaces', () => {
		const dir = setupMonorepo('builtin-cmd', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { dev: 'next dev' } },
				'packages/api': { name: 'api', scripts: { dev: 'bun run api' } }
			}
		})
		const result = resolveWorkspaceProcesses('install', dir)
		expect(Object.keys(result).sort()).toEqual(['api', 'web'])
		expect(result.web.command).toBe('npm install')
		expect(result.web.persistent).toBe(false)
	})

	test('script takes priority over built-in command', () => {
		const dir = setupMonorepo('script-priority', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { test: 'vitest' } },
				'packages/api': { name: 'api', scripts: { dev: 'bun run api' } }
			}
		})
		// "test" is a built-in npm command, but web has a test script — so only web runs
		const result = resolveWorkspaceProcesses('test', dir)
		expect(Object.keys(result)).toEqual(['web'])
		expect(result.web.command).toBe('npm run test')
		expect(result.web.persistent).toBe(true)
	})

	test('PM detection reflected in command string', () => {
		const dir = setupMonorepo('pm-detection', {
			rootPkg: { workspaces: ['packages/*'], packageManager: 'pnpm@9.0.0' },
			workspaces: {
				'packages/app': { name: 'app', scripts: { dev: 'next dev' } }
			}
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(result.app.command).toBe('pnpm run dev')
	})

	test('PM detection from lockfile', () => {
		const dir = setupMonorepo('pm-lockfile', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/app': { name: 'app', scripts: { dev: 'next dev' } }
			},
			rootFiles: { 'yarn.lock': '' }
		})
		const result = resolveWorkspaceProcesses('dev', dir)
		expect(result.app.command).toBe('yarn run dev')
	})

	test('no package.json in root throws', () => {
		const dir = join(TMP, 'no-root-pkg')
		mkdirSync(dir, { recursive: true })
		expect(() => resolveWorkspaceProcesses('dev', dir)).toThrow('No package.json')
	})

	test('no workspaces field throws', () => {
		const dir = setupMonorepo('no-ws-field', {
			rootPkg: { name: 'test' },
			workspaces: {}
		})
		expect(() => resolveWorkspaceProcesses('dev', dir)).toThrow('No "workspaces" field')
	})
})
