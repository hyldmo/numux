import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { interpolateConfig } from './interpolate'

// Save and restore env to avoid test pollution
const savedEnv: Record<string, string | undefined> = {}

beforeAll(() => {
	savedEnv.NUMUX_TEST_VAR = process.env.NUMUX_TEST_VAR
	savedEnv.NUMUX_TEST_PORT = process.env.NUMUX_TEST_PORT
	savedEnv.NUMUX_TEST_EMPTY = process.env.NUMUX_TEST_EMPTY

	process.env.NUMUX_TEST_VAR = 'hello'
	process.env.NUMUX_TEST_PORT = '3000'
	delete process.env.NUMUX_TEST_EMPTY
})

afterAll(() => {
	for (const [key, value] of Object.entries(savedEnv)) {
		if (value === undefined) {
			delete process.env[key]
		} else {
			process.env[key] = value
		}
	}
})

describe('interpolateConfig', () => {
	test('resolves ${VAR} to env value', () => {
		const result = interpolateConfig({ command: 'echo ${NUMUX_TEST_VAR}' })
		expect(result).toEqual({ command: 'echo hello' })
	})

	test('resolves multiple variables in one string', () => {
		const result = interpolateConfig({
			command: '${NUMUX_TEST_VAR}:${NUMUX_TEST_PORT}'
		})
		expect(result).toEqual({ command: 'hello:3000' })
	})

	test('replaces unset variable with empty string', () => {
		const result = interpolateConfig({ command: 'echo ${NUMUX_UNSET_VAR}' })
		expect(result).toEqual({ command: 'echo ' })
	})

	test('supports ${VAR:-default} for fallback', () => {
		const result = interpolateConfig({ command: 'echo ${NUMUX_UNSET_VAR:-fallback}' })
		expect(result).toEqual({ command: 'echo fallback' })
	})

	test('uses env value over default when set', () => {
		const result = interpolateConfig({ command: '${NUMUX_TEST_VAR:-fallback}' })
		expect(result).toEqual({ command: 'hello' })
	})

	test('supports ${VAR:?error} for required variables', () => {
		expect(() => interpolateConfig({ command: '${NUMUX_UNSET_VAR:?PORT is required}' })).toThrow('PORT is required')
	})

	test('${VAR:?} with no message uses default error', () => {
		expect(() => interpolateConfig({ command: '${NUMUX_UNSET_VAR:?}' })).toThrow(
			'Required variable NUMUX_UNSET_VAR is not set'
		)
	})

	test('does not throw for required variable that is set', () => {
		const result = interpolateConfig({ command: '${NUMUX_TEST_VAR:?must be set}' })
		expect(result).toEqual({ command: 'hello' })
	})

	test('interpolates nested objects', () => {
		const result = interpolateConfig({
			processes: {
				web: {
					command: 'listen on ${NUMUX_TEST_PORT}',
					env: { PORT: '${NUMUX_TEST_PORT}' }
				}
			}
		})
		expect(result).toEqual({
			processes: {
				web: {
					command: 'listen on 3000',
					env: { PORT: '3000' }
				}
			}
		})
	})

	test('interpolates arrays', () => {
		const result = interpolateConfig({
			envFile: ['${NUMUX_TEST_VAR}.env', 'base.env']
		})
		expect(result).toEqual({
			envFile: ['hello.env', 'base.env']
		})
	})

	test('passes through non-string values unchanged', () => {
		const result = interpolateConfig({
			persistent: true,
			maxRestarts: 5,
			nothing: null
		})
		expect(result).toEqual({
			persistent: true,
			maxRestarts: 5,
			nothing: null
		})
	})

	test('leaves strings without ${} unchanged', () => {
		const result = interpolateConfig({ command: 'echo hello world' })
		expect(result).toEqual({ command: 'echo hello world' })
	})

	test('leaves bare $VAR syntax unchanged (only ${VAR} is interpolated)', () => {
		const result = interpolateConfig({ command: 'echo $NUMUX_TEST_VAR' })
		expect(result).toEqual({ command: 'echo $NUMUX_TEST_VAR' })
	})

	test('handles empty default value', () => {
		const result = interpolateConfig({ command: '${NUMUX_UNSET_VAR:-}' })
		expect(result).toEqual({ command: '' })
	})

	test('default value can contain spaces', () => {
		const result = interpolateConfig({ command: '${NUMUX_UNSET_VAR:-hello world}' })
		expect(result).toEqual({ command: 'hello world' })
	})
})
