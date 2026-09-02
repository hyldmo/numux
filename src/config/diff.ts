import type { ResolvedNumuxConfig } from '../types'

export interface ConfigDiff {
	added: string[]
	removed: string[]
	modified: string[]
}

/** Compare two resolved configs and return the set of added, removed, and modified process names. */
export function diffConfigs(oldConfig: ResolvedNumuxConfig, newConfig: ResolvedNumuxConfig): ConfigDiff {
	const oldNames = new Set(Object.keys(oldConfig.processes))
	const newNames = new Set(Object.keys(newConfig.processes))

	const added: string[] = []
	const removed: string[] = []
	const modified: string[] = []

	for (const name of newNames) {
		if (!oldNames.has(name)) {
			added.push(name)
		} else if (JSON.stringify(oldConfig.processes[name]) !== JSON.stringify(newConfig.processes[name])) {
			modified.push(name)
		}
	}

	for (const name of oldNames) {
		if (!newNames.has(name)) {
			removed.push(name)
		}
	}

	return { added, removed, modified }
}
