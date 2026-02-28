import { type FSWatcher, watch } from 'node:fs'
import type { ResolvedNumuxConfig } from '../types'
import { log } from '../utils/logger'
import { type ConfigDiff, diffConfigs } from './diff'

const DEBOUNCE_MS = 500

export interface ConfigWatcher {
	close: () => void
}

/**
 * Watch a config file and call `onChange` with the new config and diff when it changes.
 * The `reloadConfig` function should handle the full pipeline (load, expand, validate, apply overrides).
 */
export function watchConfig(
	configPath: string,
	currentConfig: ResolvedNumuxConfig,
	reloadConfig: () => Promise<ResolvedNumuxConfig>,
	onChange: (newConfig: ResolvedNumuxConfig, diff: ConfigDiff) => void
): ConfigWatcher {
	let current = currentConfig
	let debounceTimer: ReturnType<typeof setTimeout> | null = null
	let reloading = false
	let watcher: FSWatcher | null = null

	async function reload() {
		if (reloading) return
		reloading = true
		try {
			log('[config-watch] Config file changed, reloading...')
			const config = await reloadConfig()
			const diff = diffConfigs(current, config)

			if (diff.added.length === 0 && diff.removed.length === 0 && diff.modified.length === 0) {
				log('[config-watch] No changes detected')
				return
			}

			log(
				`[config-watch] Changes: +${diff.added.length} added, -${diff.removed.length} removed, ~${diff.modified.length} modified`
			)
			current = config
			onChange(config, diff)
		} catch (err) {
			log(`[config-watch] Reload failed: ${err instanceof Error ? err.message : err}`)
		} finally {
			reloading = false
		}
	}

	try {
		watcher = watch(configPath, () => {
			if (debounceTimer) clearTimeout(debounceTimer)
			debounceTimer = setTimeout(() => {
				debounceTimer = null
				reload()
			}, DEBOUNCE_MS)
		})
		log(`[config-watch] Watching config file: ${configPath}`)
	} catch (err) {
		log(`[config-watch] Failed to watch config file: ${err}`)
	}

	return {
		close() {
			if (debounceTimer) clearTimeout(debounceTimer)
			watcher?.close()
		}
	}
}
