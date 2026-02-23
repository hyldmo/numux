import { describe, expect, test } from 'bun:test'
import { generateCompletions } from './completions'

describe('generateCompletions', () => {
	test('generates bash completions', () => {
		const output = generateCompletions('bash')
		expect(output).toContain('_numux')
		expect(output).toContain('complete -F _numux numux')
		expect(output).toContain('--prefix')
		expect(output).toContain('--config')
	})

	test('generates zsh completions', () => {
		const output = generateCompletions('zsh')
		expect(output).toContain('#compdef numux')
		expect(output).toContain('_numux')
		expect(output).toContain('--prefix')
	})

	test('generates fish completions', () => {
		const output = generateCompletions('fish')
		expect(output).toContain('complete -c numux')
		expect(output).toContain('-l prefix')
		expect(output).toContain('init')
		expect(output).toContain('validate')
	})

	test('throws on unknown shell', () => {
		expect(() => generateCompletions('powershell')).toThrow('Unknown shell: "powershell"')
	})
})
