export interface KeyHint {
	keys: string
	action: string
}

export const KEYBINDINGS: KeyHint[] = [
	{ keys: '\u2190\u2192/1-9', action: 'tabs' },
	{ keys: 'R', action: 'restart' },
	{ keys: 'S', action: 'stop/start' },
	{ keys: 'F', action: 'search' },
	{ keys: 'Y', action: 'copy' },
	{ keys: 'L', action: 'clear' },
	{ keys: 'Ctrl+C', action: 'quit' }
]

export function formatKeyHints(bindings: KeyHint[]): string {
	return bindings.map(b => `${b.keys}: ${b.action}`).join('  ')
}
