/**
 * Light/dark theme resolution. Detects terminal background via OSC 11
 * query, falling back to COLORFGBG env var, then to dark. Explicit
 * user config (`theme: 'light' | 'dark'`) skips detection entirely.
 */

export type ThemeMode = 'light' | 'dark'
export type ThemePref = ThemeMode | 'auto'

export interface StatusColors {
	ready: string
	failed: string
	stopped: string
	finished: string
	skipped: string
}

export interface Theme {
	mode: ThemeMode
	statusBarBg: string
	statusBarText: string
	helpBackdropBg: string
	helpBoxBg: string
	helpBorder: string
	helpText: string
	sidebarBg: string
	sidebarBorder: string
	tabSelectedBg: string
	tabSelectedText: string
	tabText: string
	tabDescriptionText: string
	tabSelectedDescriptionText: string
	scrollTrackBg: string
	scrollThumbBg: string
	searchCurrentBg: string
	searchMatchBg: string
	palette: readonly string[]
	status: StatusColors
	inputWaiting: string
	errorIndicator: string
	searchMatchTab: string
	iconDefault: string
}

export const DARK_THEME: Theme = {
	mode: 'dark',
	statusBarBg: '#1a1a1a',
	statusBarText: '#cccccc',
	helpBackdropBg: '#000000',
	helpBoxBg: '#1a1a2e',
	helpBorder: '#444444',
	helpText: '#cccccc',
	sidebarBg: '#1a1a1a',
	sidebarBorder: '#444444',
	tabSelectedBg: '#334455',
	tabSelectedText: '#ffffff',
	tabText: '#888888',
	tabDescriptionText: '#888888',
	tabSelectedDescriptionText: '#cccccc',
	scrollTrackBg: '#252527',
	scrollThumbBg: '#9a9ea3',
	searchCurrentBg: '#b58900',
	searchMatchBg: '#073642',
	palette: ['#00cccc', '#cccc00', '#cc00cc', '#5577ff', '#00cc00', '#ff5555', '#ffa500', '#cc88ff'],
	status: {
		ready: '#00cc00',
		failed: '#ff5555',
		stopped: '#888888',
		finished: '#66aa66',
		skipped: '#888888'
	},
	inputWaiting: '#ffaa00',
	errorIndicator: '#ff5555',
	searchMatchTab: '#b58900',
	iconDefault: '#888888'
}

export const LIGHT_THEME: Theme = {
	mode: 'light',
	statusBarBg: '#e8e8e8',
	statusBarText: '#000000',
	helpBackdropBg: '#ffffff',
	helpBoxBg: '#f5f5f5',
	helpBorder: '#aaaaaa',
	helpText: '#1a1a1a',
	sidebarBg: '#f0f0f0',
	sidebarBorder: '#aaaaaa',
	tabSelectedBg: '#7a9bbf',
	tabSelectedText: '#ffffff',
	tabText: '#444444',
	tabDescriptionText: '#666666',
	tabSelectedDescriptionText: '#e8e8e8',
	scrollTrackBg: '#d0d0d0',
	scrollThumbBg: '#888888',
	searchCurrentBg: '#ffaa33',
	searchMatchBg: '#d0e4b8',
	palette: ['#008888', '#886600', '#880088', '#0033aa', '#006600', '#aa0000', '#cc5500', '#6622aa'],
	status: {
		ready: '#006600',
		failed: '#aa0000',
		stopped: '#666666',
		finished: '#2a7a2a',
		skipped: '#666666'
	},
	inputWaiting: '#cc7a00',
	errorIndicator: '#aa0000',
	searchMatchTab: '#cc7a00',
	iconDefault: '#666666'
}

export function themeFor(mode: ThemeMode): Theme {
	return mode === 'light' ? LIGHT_THEME : DARK_THEME
}

/** WCAG relative luminance (0–1). */
export function relativeLuminance(r: number, g: number, b: number): number {
	const norm = (c: number): number => {
		const s = c / 255
		return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
	}
	return 0.2126 * norm(r) + 0.7152 * norm(g) + 0.0722 * norm(b)
}

export function isLightRgb(r: number, g: number, b: number): boolean {
	return relativeLuminance(r, g, b) > 0.5
}

/**
 * Parse OSC 11 response body. Accepts `rgb:RRRR/GGGG/BBBB` (4 hex digits,
 * xterm/Ghostty/kitty/alacritty/iTerm2) or 2-digit short form. Returns null
 * on malformed input.
 */
export function parseOSC11Response(data: string): { r: number; g: number; b: number } | null {
	const match = data.match(/rgb:([0-9a-f]+)\/([0-9a-f]+)\/([0-9a-f]+)/i)
	if (!match) return null
	const scale = (hex: string): number => {
		if (hex.length === 0 || hex.length > 4) return Number.NaN
		const val = Number.parseInt(hex, 16)
		if (Number.isNaN(val)) return Number.NaN
		const max = 16 ** hex.length - 1
		return Math.round((val / max) * 255)
	}
	const r = scale(match[1])
	const g = scale(match[2])
	const b = scale(match[3])
	if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null
	return { r, g, b }
}

/**
 * Parse COLORFGBG env var (e.g. `"15;0"` = white fg on black bg = dark).
 * Convention: bg index ≥7 is light, otherwise dark. iTerm2 sometimes sets
 * the middle field to `default`; we read the last segment as the bg.
 */
export function parseColorFgBg(value: string | undefined): ThemeMode | null {
	if (!value) return null
	const parts = value.split(';')
	if (parts.length < 2) return null
	const bgRaw = parts[parts.length - 1].trim()
	const bg = Number.parseInt(bgRaw, 10)
	if (Number.isNaN(bg)) return null
	return bg >= 7 && bg <= 15 ? 'light' : 'dark'
}

/**
 * Query the terminal's background color via OSC 11. Resolves to `null` on
 * non-TTY, timeout, or unparseable response. Runs synchronously-ish in under
 * `timeoutMs` (default 100ms). Must be called before any renderer takes
 * over stdin.
 */
export function queryOSC11(timeoutMs = 100): Promise<ThemeMode | null> {
	const stdin = process.stdin
	const stdout = process.stdout
	if (!(stdin.isTTY && stdout.isTTY)) return Promise.resolve(null)

	return new Promise<ThemeMode | null>(resolve => {
		let settled = false
		let buf = ''
		let timer: ReturnType<typeof setTimeout> | null = null
		const wasRaw = stdin.isRaw

		const finish = (result: ThemeMode | null): void => {
			if (settled) return
			settled = true
			if (timer) clearTimeout(timer)
			stdin.off('data', onData)
			try {
				if (!wasRaw) stdin.setRawMode(false)
			} catch {
				// ignore — stdin may have been closed
			}
			stdin.pause()
			resolve(result)
		}

		const onData = (chunk: Buffer): void => {
			buf += chunk.toString('utf8')
			// biome-ignore lint/suspicious/noControlCharactersInRegex: matches OSC 11 terminal response (ESC/BEL/ST)
			const match = buf.match(/\x1b\]1[01];rgb:[0-9a-f/]+(?:\x07|\x1b\\)/i)
			if (!match) return
			const parsed = parseOSC11Response(match[0])
			if (!parsed) {
				finish(null)
				return
			}
			finish(isLightRgb(parsed.r, parsed.g, parsed.b) ? 'light' : 'dark')
		}

		try {
			stdin.setRawMode(true)
			stdin.resume()
			stdin.on('data', onData)
			timer = setTimeout(() => finish(null), timeoutMs)
			stdout.write('\x1b]11;?\x1b\\')
		} catch {
			finish(null)
		}
	})
}

export async function detectThemeMode(timeoutMs = 100): Promise<ThemeMode | null> {
	const osc = await queryOSC11(timeoutMs)
	if (osc) return osc
	return parseColorFgBg(process.env.COLORFGBG)
}

/**
 * Resolve final theme. Explicit `'light'`/`'dark'` skips detection;
 * `'auto'` (or undefined) runs detection, falling back to dark.
 */
export async function resolveTheme(pref: ThemePref | undefined = 'auto'): Promise<Theme> {
	if (pref === 'light') return LIGHT_THEME
	if (pref === 'dark') return DARK_THEME
	const detected = await detectThemeMode()
	return themeFor(detected ?? 'dark')
}
