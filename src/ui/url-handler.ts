const URL_RE = /https?:\/\/[^\s<>"'`)\]},;]+/g
const FILE_PATH_RE = /(?:\.\.?\/|\/)[^\s:]+(?::(\d+)(?::(\d+))?)?/g
const TRAILING_PUNCT = /[.,;:!?)>\]'"]+$/

export interface DetectedLink {
	url: string
	start: number
	end: number
	type: 'url' | 'file'
}

export function findLinksInLine(line: string): DetectedLink[] {
	const links: DetectedLink[] = []

	for (const m of line.matchAll(URL_RE)) {
		const url = m[0].replace(TRAILING_PUNCT, '')
		links.push({
			url,
			start: m.index,
			end: m.index + url.length,
			type: 'url'
		})
	}

	for (const m of line.matchAll(FILE_PATH_RE)) {
		const start = m.index
		const end = m.index + m[0].length
		// Skip if overlapping with an already-found URL
		if (links.some(l => start < l.end && end > l.start)) continue
		links.push({
			url: m[0],
			start,
			end,
			type: 'file'
		})
	}

	return links.sort((a, b) => a.start - b.start)
}

export function findLinkAtPosition(line: string, col: number): DetectedLink | null {
	const links = findLinksInLine(line)
	return links.find(l => col >= l.start && col < l.end) ?? null
}

export function openLink(link: DetectedLink): void {
	const opener = process.platform === 'darwin' ? 'open' : process.platform === 'linux' ? 'xdg-open' : null
	if (!opener) return

	try {
		const proc = Bun.spawn([opener, link.url])
		proc.exited.catch(() => {
			/* ignore */
		})
	} catch {
		// Opener not available
	}
}
