import type { ResolvedNumuxConfig } from '../types'

/** Remove processes that don't match the current platform and strip them from dependsOn */
export function filterByPlatform(
	config: ResolvedNumuxConfig,
	currentPlatform: string = process.platform
): ResolvedNumuxConfig {
	const excluded = new Set<string>()
	for (const [name, proc] of Object.entries(config.processes)) {
		if (!proc.platform) continue
		const platforms = Array.isArray(proc.platform) ? proc.platform : [proc.platform]
		if (!platforms.includes(currentPlatform)) {
			excluded.add(name)
		}
	}

	if (excluded.size === 0) return config

	const processes: ResolvedNumuxConfig['processes'] = {}
	for (const [name, proc] of Object.entries(config.processes)) {
		if (excluded.has(name)) continue
		const copy = { ...proc }
		if (copy.dependsOn) {
			copy.dependsOn = copy.dependsOn.filter(d => !excluded.has(d))
			if (copy.dependsOn.length === 0) copy.dependsOn = undefined
		}
		processes[name] = copy
	}

	return { processes }
}
