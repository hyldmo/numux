import { describe, expect, test } from 'bun:test'
import type { ResolvedNumuxConfig } from '../types'
import { resolveDependencyTiers } from './resolver'

function makeConfig(deps: Record<string, string[]>): ResolvedNumuxConfig {
	const processes: ResolvedNumuxConfig['processes'] = {}
	for (const [name, dependsOn] of Object.entries(deps)) {
		processes[name] = { command: `echo ${name}`, dependsOn: dependsOn.length > 0 ? dependsOn : undefined }
	}
	return { processes }
}

describe('resolveDependencyTiers', () => {
	test('single process with no deps → one tier', () => {
		const tiers = resolveDependencyTiers(makeConfig({ web: [] }))
		expect(tiers).toEqual([['web']])
	})

	test('two independent processes → same tier', () => {
		const tiers = resolveDependencyTiers(makeConfig({ web: [], api: [] }))
		expect(tiers).toHaveLength(1)
		expect(tiers[0].sort()).toEqual(['api', 'web'])
	})

	test('linear chain → one process per tier', () => {
		const tiers = resolveDependencyTiers(
			makeConfig({
				db: [],
				migrate: ['db'],
				api: ['migrate'],
				web: ['api']
			})
		)
		expect(tiers).toEqual([['db'], ['migrate'], ['api'], ['web']])
	})

	test('diamond dependency → correct tier grouping', () => {
		// db → api, db → worker, api+worker → web
		const tiers = resolveDependencyTiers(
			makeConfig({
				db: [],
				api: ['db'],
				worker: ['db'],
				web: ['api', 'worker']
			})
		)
		expect(tiers).toHaveLength(3)
		expect(tiers[0]).toEqual(['db'])
		expect(tiers[1].sort()).toEqual(['api', 'worker'])
		expect(tiers[2]).toEqual(['web'])
	})

	test('detects simple cycle', () => {
		expect(() =>
			resolveDependencyTiers(
				makeConfig({
					a: ['b'],
					b: ['a']
				})
			)
		).toThrow('Dependency cycle')
	})

	test('detects cycle in larger graph', () => {
		expect(() =>
			resolveDependencyTiers(
				makeConfig({
					a: [],
					b: ['a'],
					c: ['d'],
					d: ['c']
				})
			)
		).toThrow('Dependency cycle')
	})
})
