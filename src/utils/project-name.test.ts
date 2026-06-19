import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { defaultLogDir, resolveProjectName } from './project-name'

describe('resolveProjectName', () => {
	let dir: string

	beforeEach(() => {
		dir = join(tmpdir(), `numux-test-${Date.now()}-${Math.random().toString(36).slice(2)}`)
		mkdirSync(dir, { recursive: true })
	})

	afterEach(() => {
		rmSync(dir, { recursive: true })
	})

	test('reads name from package.json', () => {
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'my-app' }))
		expect(resolveProjectName(dir)).toBe('my-app')
	})

	test('strips npm scope from name', () => {
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: '@org/my-app' }))
		expect(resolveProjectName(dir)).toBe('my-app')
	})

	test('falls back to directory basename without package.json', () => {
		const sub = join(dir, 'my-project')
		mkdirSync(sub)
		expect(resolveProjectName(sub)).toBe('my-project')
	})

	test('falls back to directory basename when name is empty', () => {
		const sub = join(dir, 'fallback-dir')
		mkdirSync(sub)
		writeFileSync(join(sub, 'package.json'), JSON.stringify({ name: '' }))
		expect(resolveProjectName(sub)).toBe('fallback-dir')
	})

	test('falls back to directory basename when name is missing', () => {
		const sub = join(dir, 'no-name')
		mkdirSync(sub)
		writeFileSync(join(sub, 'package.json'), JSON.stringify({ version: '1.0.0' }))
		expect(resolveProjectName(sub)).toBe('no-name')
	})

	test('falls back to directory basename on invalid JSON', () => {
		const sub = join(dir, 'bad-json')
		mkdirSync(sub)
		writeFileSync(join(sub, 'package.json'), 'not json')
		expect(resolveProjectName(sub)).toBe('bad-json')
	})
})

describe('defaultLogDir', () => {
	test('returns /tmp/numux/<project-name>', () => {
		const dir = join(tmpdir(), `numux-test-${Date.now()}`)
		mkdirSync(dir, { recursive: true })
		writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'cool-app' }))
		expect(defaultLogDir(dir)).toBe(join(tmpdir(), 'numux', 'cool-app'))
		rmSync(dir, { recursive: true })
	})
})
