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
	failed: '\x1b[31m',
	stopped: '\x1b[90m',
	skipped: '\x1b[90m'
}

export const ANSI_RESET = '\x1b[0m'

/** Default palette for processes without an explicit color config */
const DEFAULT_COLORS = ['\x1b[36m', '\x1b[33m', '\x1b[35m', '\x1b[34m', '\x1b[32m', '\x1b[91m', '\x1b[93m', '\x1b[95m']

/** Build a map of process names to ANSI color codes, using explicit config colors or a default palette. */
export function buildProcessColorMap(names: string[], config: ResolvedNumuxConfig): Map<string, string> {
	const map = new Map<string, string>()
	if ('NO_COLOR' in process.env) return map
	let paletteIndex = 0
	for (const name of names) {
		const explicit = config.processes[name]?.color
		if (explicit) {
			map.set(name, hexToAnsi(explicit))
		} else {
			map.set(name, DEFAULT_COLORS[paletteIndex % DEFAULT_COLORS.length])
			paletteIndex++
		}
	}
	return map
}
