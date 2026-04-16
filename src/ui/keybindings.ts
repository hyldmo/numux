/** Single-key shortcut available in non-interactive panes */
interface Shortcut {
	key: string
	label: string
	description: string
	shift?: boolean
}

export const SHORTCUTS = {
	restartAll: { key: 'r', label: 'Shift+R', description: 'restart all', shift: true },
	copy: { key: 'y', label: 'Y', description: 'copy all' },
	search: { key: 'f', label: 'F', description: 'search' },
	restart: { key: 'r', label: 'R', description: 'restart' },
	stopStart: { key: 's', label: 'S', description: 'stop/start' },
	clear: { key: 'l', label: 'L', description: 'clear' },
	timestamps: { key: 't', label: 'T', description: 'timestamps' },
	scrollToTop: { key: 'g', label: 'G', description: 'top' },
	scrollToBottom: { key: 'g', label: 'Shift+G', description: 'bottom', shift: true },
	openLogs: { key: 'o', label: 'O', description: 'open logs' }
} as const satisfies Record<string, Shortcut>

type Hint = Shortcut | [label: string, description: string]

export function toHintPair(hint: Hint): [string, string] {
	return Array.isArray(hint) ? hint : [hint.label, hint.description]
}

/** Compact hints shown in the status bar */
export const STATUS_HINTS_COMPACT: Hint[] = [
	['\u2190\u2192', 'tabs'],
	SHORTCUTS.search,
	SHORTCUTS.copy,
	['Enter', 'input'],
	['H', 'help']
]

/** Full hints shown in the help overlay */
export const STATUS_HINTS_FULL: Hint[] = [
	['\u2190\u2192/1-9', 'switch tabs'],
	['Enter', 'input mode'],
	SHORTCUTS.search,
	SHORTCUTS.restart,
	SHORTCUTS.restartAll,
	SHORTCUTS.stopStart,
	SHORTCUTS.copy,
	SHORTCUTS.clear,
	SHORTCUTS.timestamps,
	['\u2191\u2193', 'scroll line'],
	['Shift+\u2191\u2193', 'top/bottom'],
	['G/Shift+G', 'top/bottom'],
	['PgUp/PgDn', 'scroll page'],
	SHORTCUTS.openLogs,
	['Ctrl+Click', 'open link'],
	['Ctrl+C', 'quit']
]

export const STATUS_BAR_TEXT = STATUS_HINTS_COMPACT.map(h => {
	const [l, d] = toHintPair(h)
	return `${l}: ${d}`
}).join('  ')
