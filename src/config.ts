import type { NumuxConfig } from './types'

export type { NumuxConfig, NumuxProcessConfig } from './types'

/** Type-safe helper for numux.config.ts files. */
export function defineConfig<K extends string>(config: NumuxConfig<K>): NumuxConfig<K> {
	return config
}
