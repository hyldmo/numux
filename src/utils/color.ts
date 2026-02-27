/** Basic color names mapped to muted hex tones (lowercase keys) */

export type BasicColor = keyof typeof BASIC_COLORS
export type Color = `#${string}` | BasicColor

export const BASIC_COLORS = {
	black: '#000000',
	red: '#ff5555',
	green: '#00cc00',
	yellow: '#cccc00',
	blue: '#0000cc',
	magenta: '#cc00cc',
	cyan: '#00cccc',
	white: '#ffffff',
	gray: '#808080',
	grey: '#808080',
	orange: '#ffa500',
	purple: '#800080'
} as const satisfies Record<string, string>

/** Check if a string is a valid color (hex or basic name) */
export function isValidColor(color: string): boolean {
	if (HEX_COLOR_RE.test(color)) return true
	return color.toLowerCase() in BASIC_COLORS
}

/** Resolve any color (hex or basic name) to normalized hex (#rrggbb) */
export function resolveToHex(color: string): string {
	if (HEX_COLOR_RE.test(color)) return color.startsWith('#') ? color : `#${color}`
	const hex = BASIC_COLORS[color.toLowerCase() as BasicColor]
	return hex ?? ''
}

/**
 * Convert a hex color string (e.g. "#ff8800") to an ANSI true-color escape sequence.
 * Returns an empty string if the hex is malformed.
 */
export function hexToAnsi(hex: string): string {
	const h = hex.replace('#', '')
	const r = Number.parseInt(h.slice(0, 2), 16)
	const g = Number.parseInt(h.slice(2, 4), 16)
	const b = Number.parseInt(h.slice(4, 6), 16)
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return ''
	return `\x1b[38;2;${r};${g};${b}m`
}

/** Regex matching a valid 6-digit hex color (with or without leading #) */
export const HEX_COLOR_RE = /^#?[0-9a-fA-F]{6}$/

import type { ProcessStatus, ResolvedNumuxConfig } from '../types'

/** ANSI color codes for process statuses */
export const STATUS_ANSI: Partial<Record<ProcessStatus, string>> = {
	ready: hexToAnsi(BASIC_COLORS.green),
	running: hexToAnsi(BASIC_COLORS.cyan),
	finished: hexToAnsi(BASIC_COLORS.green),
	failed: hexToAnsi(BASIC_COLORS.red),
	stopped: hexToAnsi(BASIC_COLORS.gray),
	skipped: hexToAnsi(BASIC_COLORS.gray)
}

export const ANSI_RESET = '\x1b[0m'

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()#][0-9A-Za-z]|\x1b[A-Za-z><=]/g

/** Strip ANSI escape sequences from text */
export function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, '')
}

/** Default palette for automatic process color assignment — cycles through BASIC_COLORS */
const DEFAULT_PALETTE = [
	BASIC_COLORS.cyan,
	BASIC_COLORS.yellow,
	BASIC_COLORS.magenta,
	BASIC_COLORS.blue,
	BASIC_COLORS.green,
	BASIC_COLORS.red,
	BASIC_COLORS.orange,
	BASIC_COLORS.purple
] as const
const DEFAULT_ANSI_COLORS = DEFAULT_PALETTE.map(hexToAnsi)

/** Pick a deterministic color from the default palette based on the process name */
export function colorFromName(name: string): Color {
	let hash = 0
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
	}
	return DEFAULT_PALETTE[Math.abs(hash) % DEFAULT_PALETTE.length]
}

/** Resolve a color value (string or array) to a single hex string, or undefined. */
function resolveColor(color: string | string[] | undefined): string | undefined {
	if (typeof color === 'string') return color
	if (Array.isArray(color) && color.length > 0) return color[0]
	return undefined
}

/** Build a map of process names to ANSI color codes, using explicit config colors or a default palette. */
export function buildProcessColorMap(names: string[], config: ResolvedNumuxConfig): Map<string, string> {
	const map = new Map<string, string>()
	if ('NO_COLOR' in process.env) return map
	let paletteIndex = 0
	for (const name of names) {
		const explicit = resolveColor(config.processes[name]?.color)
		if (explicit) {
			const hex = resolveToHex(explicit)
			if (hex) map.set(name, hexToAnsi(hex))
			else map.set(name, DEFAULT_ANSI_COLORS[paletteIndex++ % DEFAULT_ANSI_COLORS.length])
		} else {
			map.set(name, DEFAULT_ANSI_COLORS[paletteIndex % DEFAULT_ANSI_COLORS.length])
			paletteIndex++
		}
	}
	return map
}

/** Build a map of process names to hex color strings (for StyledText rendering). */
export function buildProcessHexColorMap(names: string[], config: ResolvedNumuxConfig): Map<string, string> {
	const map = new Map<string, string>()
	if ('NO_COLOR' in process.env) return map
	let paletteIndex = 0
	for (const name of names) {
		const explicit = resolveColor(config.processes[name]?.color)
		if (explicit) {
			const hex = resolveToHex(explicit)
			if (hex) map.set(name, hex)
			else map.set(name, DEFAULT_PALETTE[paletteIndex++ % DEFAULT_PALETTE.length])
		} else {
			map.set(name, DEFAULT_PALETTE[paletteIndex % DEFAULT_PALETTE.length])
			paletteIndex++
		}
	}
	return map
}
