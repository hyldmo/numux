import { type CliRenderer, ScrollBoxRenderable } from '@opentui/core'
import { GhosttyTerminalRenderable, type HighlightRegion } from 'ghostty-opentui/terminal-buffer'

export interface SearchMatch {
	line: number
	start: number
	end: number
}

export class Pane {
	readonly scrollBox: ScrollBoxRenderable
	readonly terminal: GhosttyTerminalRenderable
	private decoder = new TextDecoder()

	private _onScroll: (() => void) | null = null

	constructor(renderer: CliRenderer, name: string, cols: number, rows: number) {
		this.scrollBox = new ScrollBoxRenderable(renderer, {
			id: `pane-${name}`,
			flexGrow: 1,
			width: '100%',
			stickyScroll: true,
			stickyStart: 'bottom',
			visible: false,
			onMouseScroll: () => this._onScroll?.()
		})

		this.terminal = new GhosttyTerminalRenderable(renderer, {
			id: `term-${name}`,
			cols,
			rows,
			persistent: true,
			showCursor: true,
			trimEnd: true
		})

		this.scrollBox.add(this.terminal)
	}

	feed(data: Uint8Array): void {
		const text = this.decoder.decode(data, { stream: true })
		this.terminal.feed(text)
	}

	resize(cols: number, rows: number): void {
		this.terminal.cols = cols
		this.terminal.rows = rows
	}

	get isAtBottom(): boolean {
		const { scrollTop, scrollHeight, viewport } = this.scrollBox
		if (scrollHeight <= 0) return true
		return scrollTop >= scrollHeight - viewport.height - 2
	}

	scrollBy(delta: number): void {
		this.scrollBox.scrollBy(delta)
	}

	scrollToTop(): void {
		this.scrollBox.scrollTo(0)
	}

	scrollToBottom(): void {
		this.scrollBox.scrollTo(this.scrollBox.scrollHeight)
	}

	onScroll(handler: () => void): void {
		this._onScroll = handler
	}

	show(): void {
		this.scrollBox.visible = true
	}

	hide(): void {
		this.scrollBox.visible = false
	}

	search(query: string): SearchMatch[] {
		if (!query) return []
		const text = this.terminal.getText()
		const lines = text.split('\n')
		const matches: SearchMatch[] = []
		const lowerQuery = query.toLowerCase()
		for (let line = 0; line < lines.length; line++) {
			const lowerLine = lines[line].toLowerCase()
			let pos = 0
			while (true) {
				const idx = lowerLine.indexOf(lowerQuery, pos)
				if (idx === -1) break
				matches.push({ line, start: idx, end: idx + query.length })
				pos = idx + 1
			}
		}
		return matches
	}

	setHighlights(matches: SearchMatch[], currentIndex: number): void {
		const regions: HighlightRegion[] = matches.map((m, i) => ({
			line: m.line,
			start: m.start,
			end: m.end,
			backgroundColor: i === currentIndex ? '#b58900' : '#073642'
		}))
		this.terminal.highlights = regions
	}

	clearHighlights(): void {
		this.terminal.highlights = undefined
	}

	scrollToLine(line: number): void {
		const pos = this.terminal.getScrollPositionForLine(line)
		this.scrollBox.scrollTo(pos)
	}

	clear(): void {
		this.terminal.reset()
	}

	destroy(): void {
		this.terminal.destroy()
	}
}
