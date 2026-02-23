import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FileWatcher } from './watcher'

describe('FileWatcher', () => {
	let watcher: FileWatcher

	afterEach(() => {
		watcher?.close()
	})

	test('triggers callback when matching file changes', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'numux-watch-'))
		writeFileSync(join(dir, 'test.ts'), 'initial')

		watcher = new FileWatcher()
		const { promise, resolve } = Promise.withResolvers<string>()

		watcher.watch('test', ['**/*.ts'], dir, path => {
			resolve(path)
		})

		// Wait for watcher to initialize
		await new Promise(r => setTimeout(r, 100))

		writeFileSync(join(dir, 'test.ts'), 'modified')

		const changedPath = await Promise.race([
			promise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
		])

		expect(changedPath).toBe('test.ts')
	}, 10000)

	test('triggers for files in subdirectories', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'numux-watch-'))
		mkdirSync(join(dir, 'src'))
		writeFileSync(join(dir, 'src', 'index.ts'), 'initial')

		watcher = new FileWatcher()
		const { promise, resolve } = Promise.withResolvers<string>()

		watcher.watch('test', ['src/**/*.ts'], dir, path => {
			resolve(path)
		})

		await new Promise(r => setTimeout(r, 100))

		writeFileSync(join(dir, 'src', 'index.ts'), 'modified')

		const changedPath = await Promise.race([
			promise,
			new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
		])

		expect(changedPath).toBe('src/index.ts')
	}, 10000)

	test('ignores files that do not match pattern', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'numux-watch-'))

		watcher = new FileWatcher()
		const calls: string[] = []

		watcher.watch('test', ['**/*.ts'], dir, path => {
			calls.push(path)
		})

		// Wait for watcher to initialize
		await new Promise(r => setTimeout(r, 200))

		// Create and modify a non-matching file after watcher is ready
		writeFileSync(join(dir, 'readme.md'), 'initial')
		writeFileSync(join(dir, 'readme.md'), 'modified')

		// Wait for debounce + processing
		await new Promise(r => setTimeout(r, 500))

		expect(calls).toHaveLength(0)
	}, 5000)

	test('ignores node_modules changes', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'numux-watch-'))
		mkdirSync(join(dir, 'node_modules'))
		writeFileSync(join(dir, 'node_modules', 'foo.ts'), 'initial')

		watcher = new FileWatcher()
		const calls: string[] = []

		watcher.watch('test', ['**/*.ts'], dir, path => {
			calls.push(path)
		})

		await new Promise(r => setTimeout(r, 100))

		writeFileSync(join(dir, 'node_modules', 'foo.ts'), 'modified')

		await new Promise(r => setTimeout(r, 500))

		expect(calls).toHaveLength(0)
	}, 5000)

	test('debounces rapid changes', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'numux-watch-'))
		writeFileSync(join(dir, 'test.ts'), 'initial')

		watcher = new FileWatcher()
		const calls: string[] = []

		watcher.watch('test', ['**/*.ts'], dir, path => {
			calls.push(path)
		})

		await new Promise(r => setTimeout(r, 100))

		// Rapid writes
		writeFileSync(join(dir, 'test.ts'), 'change1')
		writeFileSync(join(dir, 'test.ts'), 'change2')
		writeFileSync(join(dir, 'test.ts'), 'change3')

		// Wait for debounce to settle
		await new Promise(r => setTimeout(r, 600))

		// Should have been debounced to a single callback
		expect(calls).toHaveLength(1)
	}, 5000)

	test('close stops watching', async () => {
		const dir = mkdtempSync(join(tmpdir(), 'numux-watch-'))
		writeFileSync(join(dir, 'test.ts'), 'initial')

		watcher = new FileWatcher()
		const calls: string[] = []

		watcher.watch('test', ['**/*.ts'], dir, path => {
			calls.push(path)
		})

		await new Promise(r => setTimeout(r, 100))

		watcher.close()

		writeFileSync(join(dir, 'test.ts'), 'modified')

		await new Promise(r => setTimeout(r, 500))

		expect(calls).toHaveLength(0)
	}, 5000)
})
