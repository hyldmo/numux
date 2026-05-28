import { describe, expect, test } from 'bun:test'
import {
	DARK_THEME,
	isLightRgb,
	LIGHT_THEME,
	parseColorFgBg,
	parseOSC11Response,
	relativeLuminance,
	resolveTheme,
	themeFor
} from './theme'

describe('relativeLuminance', () => {
	test('black is 0', () => {
		expect(relativeLuminance(0, 0, 0)).toBe(0)
	})
	test('white is 1', () => {
		expect(relativeLuminance(255, 255, 255)).toBeCloseTo(1, 5)
	})
	test('mid gray is below 0.5', () => {
		expect(relativeLuminance(128, 128, 128)).toBeLessThan(0.5)
	})
})

describe('isLightRgb', () => {
	test('white → light', () => {
		expect(isLightRgb(255, 255, 255)).toBe(true)
	})
	test('black → dark', () => {
		expect(isLightRgb(0, 0, 0)).toBe(false)
	})
	test('solarized light bg (fdf6e3) → light', () => {
		expect(isLightRgb(0xfd, 0xf6, 0xe3)).toBe(true)
	})
	test('solarized dark bg (002b36) → dark', () => {
		expect(isLightRgb(0x00, 0x2b, 0x36)).toBe(false)
	})
})

describe('parseOSC11Response', () => {
	test('4-digit form', () => {
		const result = parseOSC11Response('\x1b]11;rgb:1a1a/1a1a/1a1a\x07')
		expect(result).toEqual({ r: 26, g: 26, b: 26 })
	})
	test('2-digit form', () => {
		const result = parseOSC11Response('\x1b]11;rgb:ff/ff/ff\x1b\\')
		expect(result).toEqual({ r: 255, g: 255, b: 255 })
	})
	test('white at full 4-digit', () => {
		const result = parseOSC11Response('rgb:ffff/ffff/ffff')
		expect(result).toEqual({ r: 255, g: 255, b: 255 })
	})
	test('solarized light', () => {
		const result = parseOSC11Response('\x1b]11;rgb:fdfd/f6f6/e3e3\x07')
		expect(result).toEqual({ r: 253, g: 246, b: 227 })
	})
	test('returns null on malformed', () => {
		expect(parseOSC11Response('garbage')).toBeNull()
		expect(parseOSC11Response('rgb:zz/zz/zz')).toBeNull()
	})
})

describe('parseColorFgBg', () => {
	test('returns null when unset', () => {
		expect(parseColorFgBg(undefined)).toBeNull()
		expect(parseColorFgBg('')).toBeNull()
	})
	test('dark bg (0)', () => {
		expect(parseColorFgBg('15;0')).toBe('dark')
	})
	test('light bg (15)', () => {
		expect(parseColorFgBg('0;15')).toBe('light')
	})
	test('light bg (7)', () => {
		expect(parseColorFgBg('0;7')).toBe('light')
	})
	test('ignores default middle field', () => {
		expect(parseColorFgBg('15;default;0')).toBe('dark')
	})
	test('returns null on malformed', () => {
		expect(parseColorFgBg('15')).toBeNull()
		expect(parseColorFgBg('x;y')).toBeNull()
	})
})

describe('themeFor', () => {
	test('light returns LIGHT_THEME', () => {
		expect(themeFor('light')).toBe(LIGHT_THEME)
	})
	test('dark returns DARK_THEME', () => {
		expect(themeFor('dark')).toBe(DARK_THEME)
	})
})

describe('resolveTheme', () => {
	test('explicit light skips detection', async () => {
		const theme = await resolveTheme('light')
		expect(theme).toBe(LIGHT_THEME)
	})
	test('explicit dark skips detection', async () => {
		const theme = await resolveTheme('dark')
		expect(theme).toBe(DARK_THEME)
	})
	test('auto with no TTY and no COLORFGBG falls back to dark', async () => {
		const prev = process.env.COLORFGBG
		delete process.env.COLORFGBG
		try {
			const theme = await resolveTheme('auto')
			expect(theme).toBe(DARK_THEME)
		} finally {
			if (prev !== undefined) process.env.COLORFGBG = prev
		}
	})
	test('auto with COLORFGBG=0;15 picks light (test runs without TTY)', async () => {
		const prev = process.env.COLORFGBG
		process.env.COLORFGBG = '0;15'
		try {
			const theme = await resolveTheme('auto')
			expect(theme).toBe(LIGHT_THEME)
		} finally {
			if (prev === undefined) delete process.env.COLORFGBG
			else process.env.COLORFGBG = prev
		}
	})
})

describe('theme shapes', () => {
	test('both themes share the same keys', () => {
		expect(Object.keys(DARK_THEME).sort()).toEqual(Object.keys(LIGHT_THEME).sort())
	})
	test('both palettes are same length', () => {
		expect(DARK_THEME.palette.length).toBe(LIGHT_THEME.palette.length)
	})
})
