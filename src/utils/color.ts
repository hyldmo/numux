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
