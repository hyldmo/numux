import { type CliRenderer, ScrollBoxRenderable, type Selection } from '@opentui/core'
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
	private _onCopy: ((text: string) => void) | null = null

	// Cached text from getText() FFI — invalidated on feed/clear/resize
	private _textLines: string[] | null = null
	private _textLinesLower: string[] | null = null

	constructor(renderer: CliRenderer, name: string, cols: number, rows: number, interactive = false) {
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
			showCursor: interactive,
			trimEnd: true,
			flexGrow: 1
		})

		// Auto-copy to clipboard when mouse selection finishes
		const origOnSelectionChanged = this.terminal.onSelectionChanged.bind(this.terminal)
		this.terminal.onSelectionChanged = (selection: Selection | null): boolean => {
			const result = origOnSelectionChanged(selection)
			if (selection?.isActive && !selection.isDragging) {
				const text = selection.getSelectedText()
				if (text) {
					this._onCopy?.(text)
				} else {
					// Click without drag — clear the empty selection to prevent
					// visual block artifacts from the text buffer's highlight
					queueMicrotask(() => renderer.clearSelection())
				}
			}
			return result
		}

		this.scrollBox.add(this.terminal)
	}

	feed(data: Uint8Array): void {
		const text = this.decoder.decode(data, { stream: true })
		this.terminal.feed(text)
		this._textLines = null
		this._textLinesLower = null
	}

	resize(cols: number, rows: number): void {
		this.terminal.cols = cols
		this.terminal.rows = rows
		this._textLines = null
		this._textLinesLower = null
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

	onCopy(handler: (text: string) => void): void {
		this._onCopy = handler
	}

	show(): void {
		this.scrollBox.visible = true
	}

	hide(): void {
		this.scrollBox.visible = false
	}

	search(query: string): SearchMatch[] {
		if (!query) return []
		// Use cached text to avoid repeated getText() FFI calls
		if (!this._textLines) {
			const text = this.terminal.getText()
			this._textLines = text.split('\n')
			this._textLinesLower = this._textLines.map(l => l.toLowerCase())
		}
		const lines = this._textLinesLower!
		const matches: SearchMatch[] = []
		const lowerQuery = query.toLowerCase()
		for (let line = 0; line < lines.length; line++) {
			let pos = 0
			while (true) {
				const idx = lines[line].indexOf(lowerQuery, pos)
				if (idx === -1) break
				matches.push({ line, start: idx, end: idx + query.length })
				pos = idx + 1
			}
		}
		return matches
	}

	setHighlights(matches: SearchMatch[], currentIndex: number): void {
		// Filter to visible viewport lines to avoid sending thousands of off-screen highlights
		const firstVisible = Math.max(0, Math.floor(this.scrollBox.scrollTop) - 2)
		const lastVisible = Math.ceil(this.scrollBox.scrollTop + this.scrollBox.viewport.height) + 2
		const regions: HighlightRegion[] = []
		for (let i = 0; i < matches.length; i++) {
			const m = matches[i]
			if (m.line < firstVisible || m.line > lastVisible) {
				// Always include the current match so it highlights even if we're about to scroll to it
				if (i !== currentIndex) continue
			}
			regions.push({
				line: m.line,
				start: m.start,
				end: m.end,
				backgroundColor: i === currentIndex ? '#b58900' : '#073642'
			})
		}
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
		this._textLines = null
		this._textLinesLower = null
	}

	destroy(): void {
		this.terminal.destroy()
	}
}
