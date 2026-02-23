/** Single-key shortcut available in non-interactive panes */
interface Shortcut {
	key: string
	label: string
	description: string
	shift?: boolean
}

export const SHORTCUTS = {
	restartAll: { key: 'r', label: 'Shift+R', description: 'restart all', shift: true },
	copy: { key: 'y', label: 'Y', description: 'copy' },
	search: { key: 'f', label: 'F', description: 'search' },
	restart: { key: 'r', label: 'R', description: 'restart' },
	stopStart: { key: 's', label: 'S', description: 'stop/start' },
	clear: { key: 'l', label: 'L', description: 'clear' }
} as const satisfies Record<string, Shortcut>

/** Hints shown in the status bar (subset + navigation keys) */
const STATUS_HINTS: [label: string, description: string][] = [
	['\u2190\u2192/1-9', 'tabs'],
	[SHORTCUTS.restart.label, SHORTCUTS.restart.description],
	[SHORTCUTS.stopStart.label, SHORTCUTS.stopStart.description],
	[SHORTCUTS.search.label, SHORTCUTS.search.description],
	[SHORTCUTS.copy.label, SHORTCUTS.copy.description],
	[SHORTCUTS.clear.label, SHORTCUTS.clear.description],
	['Ctrl+C', 'quit']
]

export const STATUS_BAR_TEXT = STATUS_HINTS.map(([l, d]) => `${l}: ${d}`).join('  ')
