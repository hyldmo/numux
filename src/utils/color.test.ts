import { describe, expect, test } from 'bun:test'
import { BASIC_COLORS, colorFromName, HEX_COLOR_RE, hexToAnsi, isValidColor, resolveToHex, stripAnsi } from './color'

describe('hexToAnsi', () => {
	test('converts #rrggbb to ANSI true-color sequence', () => {
		expect(hexToAnsi('#ff8800')).toBe('\x1b[38;2;255;136;0m')
	})

	test('converts without leading #', () => {
		expect(hexToAnsi('ff8800')).toBe('\x1b[38;2;255;136;0m')
	})

	test('converts black', () => {
		expect(hexToAnsi('#000000')).toBe('\x1b[38;2;0;0;0m')
	})

	test('converts white', () => {
		expect(hexToAnsi('#ffffff')).toBe('\x1b[38;2;255;255;255m')
	})

	test('returns empty string for malformed hex', () => {
		expect(hexToAnsi('zzzzzz')).toBe('')
		expect(hexToAnsi('#gggggg')).toBe('')
		expect(hexToAnsi('')).toBe('')
	})
})

describe('isValidColor', () => {
	test('accepts hex colors', () => {
		expect(isValidColor('#ff8800')).toBe(true)
		expect(isValidColor('ff8800')).toBe(true)
	})

	test('accepts basic color names', () => {
		for (const name of Object.keys(BASIC_COLORS)) {
			expect(isValidColor(name)).toBe(true)
			expect(isValidColor(name.toUpperCase())).toBe(true)
		}
	})

	test('rejects invalid colors', () => {
		expect(isValidColor('indigo')).toBe(false)
		expect(isValidColor('#fff')).toBe(false)
		expect(isValidColor('')).toBe(false)
	})
})

describe('resolveToHex', () => {
	test('returns hex for hex input', () => {
		expect(resolveToHex('#ff8800')).toBe('#ff8800')
		expect(resolveToHex('ff8800')).toBe('#ff8800')
	})

	test('returns hex for basic color names', () => {
		expect(resolveToHex('black')).toBe('#000000')
		expect(resolveToHex('red')).toBe('#ff5555')
		expect(resolveToHex('green')).toBe('#00cc00')
		expect(resolveToHex('yellow')).toBe('#cccc00')
		expect(resolveToHex('blue')).toBe('#0000cc')
		expect(resolveToHex('magenta')).toBe('#cc00cc')
		expect(resolveToHex('cyan')).toBe('#00cccc')
		expect(resolveToHex('white')).toBe('#ffffff')
		expect(resolveToHex('gray')).toBe('#808080')
		expect(resolveToHex('grey')).toBe('#808080')
		expect(resolveToHex('orange')).toBe('#ffa500')
		expect(resolveToHex('purple')).toBe('#800080')
	})

	test('is case-insensitive for names', () => {
		expect(resolveToHex('RED')).toBe('#ff5555')
	})

	test('returns empty string for invalid', () => {
		expect(resolveToHex('indigo')).toBe('')
	})
})

describe('HEX_COLOR_RE', () => {
	test('matches 6-digit hex with #', () => {
		expect(HEX_COLOR_RE.test('#ff8800')).toBe(true)
		expect(HEX_COLOR_RE.test('#000000')).toBe(true)
		expect(HEX_COLOR_RE.test('#FFFFFF')).toBe(true)
		expect(HEX_COLOR_RE.test('#aAbBcC')).toBe(true)
	})

	test('matches 6-digit hex without #', () => {
		expect(HEX_COLOR_RE.test('ff8800')).toBe(true)
	})

	test('rejects invalid formats', () => {
		expect(HEX_COLOR_RE.test('#fff')).toBe(false)
		expect(HEX_COLOR_RE.test('#gggggg')).toBe(false)
		expect(HEX_COLOR_RE.test('#ff88001')).toBe(false)
		expect(HEX_COLOR_RE.test('')).toBe(false)
	})
})

describe('colorFromName', () => {
	test('returns consistent colors for known names', () => {
		expect(colorFromName('api')).toBe('#cc00cc')
		expect(colorFromName('web')).toBe('#00cc00')
		expect(colorFromName('db')).toBe('#ffa500')
		expect(colorFromName('worker')).toBe('#cc00cc')
		expect(colorFromName('redis')).toBe('#0000cc')
		expect(colorFromName('migrate')).toBe('#0000cc')
		expect(colorFromName('proxy')).toBe('#ffa500')
		expect(colorFromName('cache')).toBe('#cc00cc')
	})

	test('different names can produce different colors', () => {
		const colors = new Set(['api', 'web', 'db', 'worker', 'redis'].map(colorFromName))
		expect(colors.size).toBeGreaterThan(1)
	})
})

describe('stripAnsi', () => {
	test('strips basic SGR sequences', () => {
		expect(stripAnsi('\x1b[32mgreen\x1b[0m')).toBe('green')
	})

	test('strips true-color sequences', () => {
		expect(stripAnsi('\x1b[38;2;255;136;0mhello\x1b[0m')).toBe('hello')
	})

	test('strips DEC private mode sequences', () => {
		expect(stripAnsi('\x1b[?25h')).toBe('')
		expect(stripAnsi('\x1b[?25l')).toBe('')
		expect(stripAnsi('\x1b[?1049h')).toBe('')
		expect(stripAnsi('text\x1b[?25hmore')).toBe('textmore')
	})

	test('strips OSC sequences (BEL terminated)', () => {
		expect(stripAnsi('\x1b]0;window title\x07')).toBe('')
	})

	test('strips OSC sequences (ST terminated)', () => {
		expect(stripAnsi('\x1b]0;window title\x1b\\')).toBe('')
	})

	test('strips charset sequences', () => {
		expect(stripAnsi('\x1b(B')).toBe('')
		expect(stripAnsi('\x1b)0')).toBe('')
	})

	test('strips simple ESC sequences', () => {
		expect(stripAnsi('\x1bM')).toBe('')
		expect(stripAnsi('\x1b=')).toBe('')
		expect(stripAnsi('\x1b>')).toBe('')
	})

	test('preserves plain text', () => {
		expect(stripAnsi('hello world')).toBe('hello world')
	})

	test('handles mixed content', () => {
		expect(stripAnsi('\x1b[1mbold\x1b[0m \x1b[?25lplain\x1b[?25h')).toBe('bold plain')
	})

	test('strips cursor movement sequences', () => {
		expect(stripAnsi('\x1b[10;20H')).toBe('')
		expect(stripAnsi('\x1b[5A')).toBe('')
		expect(stripAnsi('\x1b[3B')).toBe('')
		expect(stripAnsi('\x1b[2J')).toBe('')
		expect(stripAnsi('\x1b[K')).toBe('')
	})

	test('strips OSC 8 hyperlinks', () => {
		expect(stripAnsi('\x1b]8;;https://example.com\x07Link\x1b]8;;\x07')).toBe('Link')
		expect(stripAnsi('\x1b]8;;https://example.com\x1b\\Link\x1b]8;;\x1b\\')).toBe('Link')
	})

	test('strips 256-color sequences', () => {
		expect(stripAnsi('\x1b[38;5;196mred\x1b[0m')).toBe('red')
		expect(stripAnsi('\x1b[48;5;21mblue bg\x1b[0m')).toBe('blue bg')
	})

	test('strips multiple SGR params', () => {
		expect(stripAnsi('\x1b[1;3;4;31mbold italic underline red\x1b[0m')).toBe('bold italic underline red')
	})

	test('handles empty string', () => {
		expect(stripAnsi('')).toBe('')
	})

	test('preserves text with special characters', () => {
		expect(stripAnsi('hello → world')).toBe('hello → world')
		expect(stripAnsi('日本語テスト')).toBe('日本語テスト')
		expect(stripAnsi('emoji 🎉 test')).toBe('emoji 🎉 test')
	})

	test('handles consecutive escape sequences', () => {
		expect(stripAnsi('\x1b[1m\x1b[31m\x1b[4mtext\x1b[0m')).toBe('text')
	})

	test('strips scroll region sequences', () => {
		expect(stripAnsi('\x1b[1;24r')).toBe('')
	})

	test('handles real-world colored output', () => {
		const npmOutput = '\x1b[32m✓\x1b[0m \x1b[90m1 test passed\x1b[0m'
		expect(stripAnsi(npmOutput)).toBe('✓ 1 test passed')
	})
})
