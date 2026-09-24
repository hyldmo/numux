import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { NumuxConfig, NumuxProcessConfig } from '../types'
import { expandWorkspaces, extractScriptFromCommand, resolveWorkspaceProcesses } from './workspaces'

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

describe('extractScriptFromCommand', () => {
	test('npm run script', () => {
		expect(extractScriptFromCommand('npm run lint')).toBe('lint')
	})

	test('yarn run script', () => {
		expect(extractScriptFromCommand('yarn run dev')).toBe('dev')
	})

	test('pnpm run script', () => {
		expect(extractScriptFromCommand('pnpm run build')).toBe('build')
	})

	test('bun run script', () => {
		expect(extractScriptFromCommand('bun run test')).toBe('test')
	})

	test('raw command returns null', () => {
		expect(extractScriptFromCommand('eslint .')).toBeNull()
	})

	test('command without run returns null', () => {
		expect(extractScriptFromCommand('npm install')).toBeNull()
	})
})

describe('expandWorkspaces', () => {
	function makeConfig(dir: string, processes: Record<string, NumuxProcessConfig | string>): NumuxConfig {
		return { cwd: dir, processes }
	}

	test('workspaces: true expands to per-workspace processes', () => {
		const dir = setupMonorepo('expand-all', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { lint: 'eslint .' } },
				'packages/api': { name: 'api', scripts: { lint: 'eslint .' } }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				lint: { command: 'npm run lint', workspaces: true }
			})
		)
		const names = Object.keys(result.processes).sort()
		expect(names).toEqual(['lint:api', 'lint:web'])
	})

	test('workspaces: true filters by script availability', () => {
		const dir = setupMonorepo('expand-filter-script', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { lint: 'eslint .', dev: 'next dev' } },
				'packages/api': { name: 'api', scripts: { dev: 'bun run api' } }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				lint: { command: 'npm run lint', workspaces: true }
			})
		)
		expect(Object.keys(result.processes)).toEqual(['lint:web'])
	})

	test('workspaces: true with raw command includes all workspaces', () => {
		const dir = setupMonorepo('expand-raw-cmd', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { dev: 'next dev' } },
				'packages/api': { name: 'api', scripts: {} }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				check: { command: 'eslint .', workspaces: true }
			})
		)
		const names = Object.keys(result.processes).sort()
		expect(names).toEqual(['check:api', 'check:web'])
	})

	test('workspaces: true inherits template config', () => {
		const dir = setupMonorepo('expand-inherit', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { dev: 'next dev' } }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				dev: {
					command: 'npm run dev',
					workspaces: true,
					env: { NODE_ENV: 'development' },
					maxRestarts: 3,
					readyPattern: 'ready'
				}
			})
		)
		const proc = result.processes['dev:web'] as NumuxProcessConfig
		expect(proc.env).toEqual({ NODE_ENV: 'development' })
		expect(proc.maxRestarts).toBe(3)
		expect(proc.readyPattern).toBe('ready')
		expect(proc.cwd).toBe(join(dir, 'packages/web'))
		expect((proc as unknown as Record<string, unknown>).workspaces).toBeUndefined()
	})

	test('workspaces: string expands to single process', () => {
		const dir = setupMonorepo('expand-single', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: '@repo/web', scripts: { validate: 'tsc' } },
				'packages/api': { name: '@repo/api', scripts: { validate: 'tsc' } }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				validate: { command: 'npm run validate', workspaces: '@repo/web' }
			})
		)
		expect(Object.keys(result.processes)).toEqual(['validate:web'])
		expect((result.processes['validate:web'] as NumuxProcessConfig).cwd).toBe(join(dir, 'packages/web'))
	})

	test('workspaces: string[] expands to multiple processes', () => {
		const dir = setupMonorepo('expand-multi', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: '@repo/web', scripts: {} },
				'packages/api': { name: '@repo/api', scripts: {} },
				'packages/core': { name: '@repo/core', scripts: {} }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				dev: { command: 'npm run dev', workspaces: ['@repo/api', '@repo/web'] }
			})
		)
		const names = Object.keys(result.processes)
		expect(names).toEqual(['dev:api', 'dev:web'])
	})

	test('resolves by scope-stripped name', () => {
		const dir = setupMonorepo('expand-scope-stripped', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: '@repo/web', scripts: {} }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				dev: { command: 'npm run dev', workspaces: 'web' }
			})
		)
		expect(Object.keys(result.processes)).toEqual(['dev:web'])
	})

	test('resolves by relative path fallback', () => {
		const dir = setupMonorepo('expand-path-fallback', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: '@repo/web', scripts: {} }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				dev: { command: 'npm run dev', workspaces: 'packages/web' }
			})
		)
		expect(Object.keys(result.processes)).toEqual(['dev:web'])
	})

	test('workspace not found throws with available list', () => {
		const dir = setupMonorepo('expand-not-found', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: {} },
				'packages/api': { name: 'api', scripts: {} }
			}
		})
		expect(() =>
			expandWorkspaces(
				makeConfig(dir, {
					dev: { command: 'npm run dev', workspaces: 'nonexistent' }
				})
			)
		).toThrow('workspace "nonexistent" not found. Available: api, web')
	})

	test('workspaces + cwd conflict throws', () => {
		const dir = setupMonorepo('expand-cwd-conflict', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: {} }
			}
		})
		expect(() =>
			expandWorkspaces(
				makeConfig(dir, {
					dev: { command: 'npm run dev', workspaces: true, cwd: '/some/path' }
				})
			)
		).toThrow('cannot set both "workspaces" and "cwd"')
	})

	test('workspaces without command throws', () => {
		const dir = setupMonorepo('expand-no-cmd', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: {} }
			}
		})
		expect(() =>
			expandWorkspaces(
				makeConfig(dir, {
					dev: { workspaces: true } as unknown as NumuxProcessConfig
				})
			)
		).toThrow('workspaces requires a "command"')
	})

	test('no workspaces match script throws', () => {
		const dir = setupMonorepo('expand-no-script-match', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { build: 'tsc' } }
			}
		})
		expect(() =>
			expandWorkspaces(
				makeConfig(dir, {
					lint: { command: 'npm run lint', workspaces: true }
				})
			)
		).toThrow('no workspaces have a "lint" script')
	})

	test('non-workspace processes pass through unchanged', () => {
		const dir = setupMonorepo('expand-passthrough', {
			rootPkg: { workspaces: ['packages/*'] },
			workspaces: {
				'packages/web': { name: 'web', scripts: { dev: 'next dev' } }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				db: 'docker compose up db',
				dev: { command: 'npm run dev', workspaces: true }
			})
		)
		expect(result.processes.db).toBe('docker compose up db')
		expect(Object.keys(result.processes)).toEqual(['db', 'dev:web'])
	})

	test('name deduplication on collision', () => {
		const dir = setupMonorepo('expand-dedup', {
			rootPkg: { workspaces: ['apps/*', 'libs/*'] },
			workspaces: {
				'apps/core': { name: 'core', scripts: { dev: 'next dev' } },
				'libs/core': { name: 'core', scripts: { dev: 'tsc -w' } }
			}
		})
		const result = expandWorkspaces(
			makeConfig(dir, {
				dev: { command: 'npm run dev', workspaces: true }
			})
		)
		const names = Object.keys(result.processes).sort()
		expect(names).toEqual(['dev:core', 'dev:core-1'])
	})
})
