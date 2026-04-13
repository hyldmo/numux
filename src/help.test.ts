import { describe, expect, test } from 'bun:test'
import { showHelp } from './help'

describe('showHelp', () => {
	test('no topic lists available topics', () => {
		const output = showHelp()
		expect(output).toContain('Available help topics')
		expect(output).toContain('keybindings')
	})

	test('valid topic returns content', () => {
		const output = showHelp('keybindings')
		expect(output).toContain('Keybindings')
	})

	test('alias resolves to topic', () => {
		const direct = showHelp('keybindings')
		const aliased = showHelp('keys')
		expect(aliased).toBe(direct)
	})

	test('unknown topic returns error', () => {
		const output = showHelp('nonexistent')
		expect(output).toContain('Unknown topic')
		expect(output).toContain('Available topics')
	})
})
