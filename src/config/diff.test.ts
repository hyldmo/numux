import { describe, expect, test } from 'bun:test'
import type { ResolvedNumuxConfig } from '../types'
import { diffConfigs } from './diff'

function makeConfig(processes: Record<string, { command: string; [k: string]: unknown }>): ResolvedNumuxConfig {
	return { processes } as ResolvedNumuxConfig
}

describe('diffConfigs', () => {
	test('detects added processes', () => {
		const old = makeConfig({ api: { command: 'node api.js' } })
		const next = makeConfig({
			api: { command: 'node api.js' },
			web: { command: 'node web.js' }
		})
		const diff = diffConfigs(old, next)
		expect(diff.added).toEqual(['web'])
		expect(diff.removed).toEqual([])
		expect(diff.modified).toEqual([])
	})

	test('detects removed processes', () => {
		const old = makeConfig({
			api: { command: 'node api.js' },
			web: { command: 'node web.js' }
		})
		const next = makeConfig({ api: { command: 'node api.js' } })
		const diff = diffConfigs(old, next)
		expect(diff.added).toEqual([])
		expect(diff.removed).toEqual(['web'])
		expect(diff.modified).toEqual([])
	})

	test('detects modified processes', () => {
		const old = makeConfig({ api: { command: 'node api.js' } })
		const next = makeConfig({ api: { command: 'node api-v2.js' } })
		const diff = diffConfigs(old, next)
		expect(diff.added).toEqual([])
		expect(diff.removed).toEqual([])
		expect(diff.modified).toEqual(['api'])
	})

	test('detects all change types at once', () => {
		const old = makeConfig({
			api: { command: 'node api.js' },
			web: { command: 'node web.js' },
			db: { command: 'postgres' }
		})
		const next = makeConfig({
			api: { command: 'node api-v2.js' },
			db: { command: 'postgres' },
			worker: { command: 'node worker.js' }
		})
		const diff = diffConfigs(old, next)
		expect(diff.added).toEqual(['worker'])
		expect(diff.removed).toEqual(['web'])
		expect(diff.modified).toEqual(['api'])
	})

	test('returns empty diff for identical configs', () => {
		const config = makeConfig({ api: { command: 'node api.js' } })
		const diff = diffConfigs(config, config)
		expect(diff.added).toEqual([])
		expect(diff.removed).toEqual([])
		expect(diff.modified).toEqual([])
	})

	test('handles empty old config', () => {
		const old = makeConfig({})
		const next = makeConfig({ api: { command: 'node api.js' } })
		const diff = diffConfigs(old, next)
		expect(diff.added).toEqual(['api'])
		expect(diff.removed).toEqual([])
		expect(diff.modified).toEqual([])
	})

	test('handles empty new config', () => {
		const old = makeConfig({ api: { command: 'node api.js' } })
		const next = makeConfig({})
		const diff = diffConfigs(old, next)
		expect(diff.added).toEqual([])
		expect(diff.removed).toEqual(['api'])
		expect(diff.modified).toEqual([])
	})

	test('detects nested config changes', () => {
		const old = makeConfig({
			api: { command: 'node api.js', env: { PORT: '3000' } }
		})
		const next = makeConfig({
			api: { command: 'node api.js', env: { PORT: '4000' } }
		})
		const diff = diffConfigs(old, next)
		expect(diff.modified).toEqual(['api'])
	})
})
