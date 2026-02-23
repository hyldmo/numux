import type { NumuxConfig } from '../types'

/**
 * Kahn's topological sort — groups processes into tiers.
 * Tier 0: no deps, Tier 1: deps all in tier 0, etc.
 * Throws if a cycle is detected.
 */
export function resolveDependencyTiers(config: NumuxConfig): string[][] {
	const names = Object.keys(config.processes)
	const inDegree = new Map<string, number>()
	const dependents = new Map<string, string[]>()

	for (const name of names) {
		inDegree.set(name, 0)
		dependents.set(name, [])
	}

	for (const name of names) {
		const deps = config.processes[name].dependsOn ?? []
		inDegree.set(name, deps.length)
		for (const dep of deps) {
			dependents.get(dep)!.push(name)
		}
	}

	const tiers: string[][] = []
	const remaining = new Set(names)

	while (remaining.size > 0) {
		const tier = [...remaining].filter(n => inDegree.get(n) === 0)

		if (tier.length === 0) {
			const cycle = [...remaining].join(', ')
			throw new Error(`Dependency cycle detected among: ${cycle}`)
		}

		tiers.push(tier)

		for (const name of tier) {
			remaining.delete(name)
			for (const dep of dependents.get(name)!) {
				inDegree.set(dep, inDegree.get(dep)! - 1)
			}
		}
	}

	return tiers
}
