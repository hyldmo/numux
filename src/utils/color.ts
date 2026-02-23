/** Basic color names mapped to hex (lowercase keys) — 8 ANSI base + gray/orange */
export const BASIC_COLORS: Record<string, string> = {
	black: '#000000',
	red: '#ff0000',
	green: '#00ff00',
	yellow: '#ffff00',
	blue: '#0000ff',
	magenta: '#ff00ff',
	cyan: '#00ffff',
	white: '#ffffff',
	gray: '#808080',
	grey: '#808080',
	orange: '#ffa500',
	purple: '#800080'
}

/** Check if a string is a valid color (hex or basic name) */
export function isValidColor(color: string): boolean {
	if (HEX_COLOR_RE.test(color)) return true
	return color.toLowerCase() in BASIC_COLORS
}

/** Resolve any color (hex or basic name) to normalized hex (#rrggbb) */
export function resolveToHex(color: string): string {
	if (HEX_COLOR_RE.test(color)) return color.startsWith('#') ? color : `#${color}`
	const hex = BASIC_COLORS[color.toLowerCase()]
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
	ready: '\x1b[32m',
	running: '\x1b[36m',
	finished: '\x1b[32m',
	failed: '\x1b[31m',
	stopped: '\x1b[90m',
	skipped: '\x1b[90m'
}

export const ANSI_RESET = '\x1b[0m'

// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape stripping requires matching control chars
const ANSI_RE = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[()#][0-9A-Za-z]|\x1b[A-Za-z><=]/g

/** Strip ANSI escape sequences from text */
export function stripAnsi(str: string): string {
	return str.replace(ANSI_RE, '')
}

/** Default palette as ANSI codes (for prefix mode stdout output) */
const DEFAULT_ANSI_COLORS = [
	'\x1b[36m',
	'\x1b[33m',
	'\x1b[35m',
	'\x1b[34m',
	'\x1b[32m',
	'\x1b[91m',
	'\x1b[93m',
	'\x1b[95m'
]

/** Default palette as hex colors (for styled text rendering) */
const DEFAULT_HEX_COLORS = ['#00cccc', '#cccc00', '#cc00cc', '#0000cc', '#00cc00', '#ff5555', '#ffff55', '#ff55ff']

/** Pick a deterministic color from the default palette based on the process name */
export function colorFromName(name: string): string {
	let hash = 0
	for (let i = 0; i < name.length; i++) {
		hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0
	}
	return DEFAULT_HEX_COLORS[Math.abs(hash) % DEFAULT_HEX_COLORS.length]
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
			else map.set(name, DEFAULT_HEX_COLORS[paletteIndex++ % DEFAULT_HEX_COLORS.length])
		} else {
			map.set(name, DEFAULT_HEX_COLORS[paletteIndex % DEFAULT_HEX_COLORS.length])
			paletteIndex++
		}
	}
	return map
}
