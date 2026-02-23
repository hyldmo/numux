import type { NumuxConfig } from './types'

export type { NumuxConfig, NumuxProcessConfig } from './types'

/** Type-safe helper for numux.config.ts files. */
export function defineConfig(config: NumuxConfig): NumuxConfig {
	return config
}
