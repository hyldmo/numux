/**
 * Environment variable interpolation for config values.
 * Supports ${VAR}, ${VAR:-default}, and ${VAR:?error} syntax.
 */

// Matches ${VAR}, ${VAR:-default}, ${VAR:?error message}
const VAR_RE = /\$\{([^}:]+)(?::([-?])([^}]*))?\}/g

/** Recursively interpolate environment variables in all string values of a config object */
export function interpolateConfig<T>(config: T): T {
	return interpolateValue(config) as T
}

function interpolateValue(value: unknown): unknown {
	if (typeof value === 'string') {
		return interpolateString(value)
	}
	if (Array.isArray(value)) {
		return value.map(interpolateValue)
	}
	if (value instanceof RegExp) {
		return value
	}
	if (value && typeof value === 'object') {
		const result: Record<string, unknown> = {}
		for (const [k, v] of Object.entries(value)) {
			result[k] = interpolateValue(v)
		}
		return result
	}
	return value
}

function interpolateString(str: string): string {
	return str.replace(VAR_RE, (_match, name: string, operator?: string, operand?: string) => {
		const value = process.env[name]

		if (value !== undefined && value !== '') {
			return value
		}

		if (operator === '-') {
			return operand ?? ''
		}

		if (operator === '?') {
			throw new Error(operand || `Required variable ${name} is not set`)
		}

		// Unset with no operator → empty string
		return ''
	})
}
