import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { loadEnvFiles, parseEnvFile } from './env-file'

describe('parseEnvFile', () => {
	test('parses simple key=value pairs', () => {
		const result = parseEnvFile('FOO=bar\nBAZ=qux')
		expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
	})

	test('ignores comments and blank lines', () => {
		const result = parseEnvFile('# comment\nFOO=bar\n\n# another\nBAZ=qux\n')
		expect(result).toEqual({ FOO: 'bar', BAZ: 'qux' })
	})

	test('strips double quotes', () => {
		const result = parseEnvFile('FOO="hello world"')
		expect(result).toEqual({ FOO: 'hello world' })
	})

	test('strips single quotes', () => {
		const result = parseEnvFile("FOO='hello world'")
		expect(result).toEqual({ FOO: 'hello world' })
	})

	test('handles values with equals signs', () => {
		const result = parseEnvFile('URL=http://localhost:3000?foo=bar')
		expect(result).toEqual({ URL: 'http://localhost:3000?foo=bar' })
	})

	test('handles empty values', () => {
		const result = parseEnvFile('FOO=')
		expect(result).toEqual({ FOO: '' })
	})

	test('trims whitespace around keys and values', () => {
		const result = parseEnvFile('  FOO  =  bar  ')
		expect(result).toEqual({ FOO: 'bar' })
	})

	test('skips lines without equals sign', () => {
		const result = parseEnvFile('INVALID\nFOO=bar')
		expect(result).toEqual({ FOO: 'bar' })
	})
})

describe('loadEnvFiles', () => {
	const tmpDir = join(import.meta.dir, '../../.tmp-env-test')

	beforeAll(() => {
		mkdirSync(tmpDir, { recursive: true })
		writeFileSync(join(tmpDir, '.env'), 'A=1\nB=2\n')
		writeFileSync(join(tmpDir, '.env.local'), 'B=overridden\nC=3\n')
	})

	afterAll(() => {
		rmSync(tmpDir, { recursive: true, force: true })
	})

	test('loads a single env file', () => {
		const result = loadEnvFiles('.env', tmpDir)
		expect(result).toEqual({ A: '1', B: '2' })
	})

	test('loads multiple env files with later files overriding', () => {
		const result = loadEnvFiles(['.env', '.env.local'], tmpDir)
		expect(result).toEqual({ A: '1', B: 'overridden', C: '3' })
	})

	test('throws with clear message on missing file', () => {
		expect(() => loadEnvFiles('.env.missing', tmpDir)).toThrow('envFile not found')
	})
})
