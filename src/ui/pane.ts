import {
	type CliRenderer,
	LineNumberRenderable,
	type LineSign,
	ScrollBoxRenderable,
	type Selection
} from '@opentui/core'
import { GhosttyTerminalRenderable, type HighlightRegion } from 'ghostty-opentui/terminal-buffer'
import { DEFAULT_TIMESTAMP_FORMAT, formatTimestamp } from '../utils/timestamp'
import { type DetectedLink, findLinkAtPosition } from './url-handler'

export interface SearchMatch {
	line: number
	start: number
	end: number
}

// Cap the native terminal buffer to prevent unbounded growth. getJson()
// serializes the entire buffer on each render — a huge buffer freezes the
// event loop. Full output is always available in log files, so resetting
// only loses in-terminal scrollback.
const MAX_SCROLLBACK_LINES = 50_000
// Fallback byte cap for hidden panes where lineCount isn't updated
const MAX_BUFFER_BYTES = 10 * 1024 * 1024

export class Pane {
	readonly scrollBox: ScrollBoxRenderable
	readonly terminal: GhosttyTerminalRenderable
	private decoder = new TextDecoder()
	private bytesFed = 0

	// Timestamp gutter
	private renderer: CliRenderer
	private timestampGutter: LineNumberRenderable | null = null
	private _timestampFormat: string | null = null
	/** Epoch ms when each logical line was first created */
	lineTimestamps: number[] = []
	private lineCounter = 0

	private _onScroll: (() => void) | null = null
	private _onCopy: ((text: string) => void) | null = null
	private _onLinkClick: ((link: DetectedLink) => void) | null = null

	constructor(renderer: CliRenderer, name: string, cols: number, rows: number, interactive = false) {
		this.renderer = renderer
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
				// Use terminal's local getSelectedText() instead of the global
				// selection's, since _selectedRenderables may not be updated yet
				// during the walk that triggers this callback.
				const text = this.terminal.getSelectedText()
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

		// Ctrl+click to open links
		this.terminal.onMouseDown = event => {
			if (event.modifiers.ctrl && event.button === 0) {
				const link = this.getLinkAtMouse(event.x, event.y)
				if (link) {
					event.stopPropagation()
					this._onLinkClick?.(link)
				}
			}
		}

		this.scrollBox.add(this.terminal)
	}

	feed(data: Uint8Array): void {
		this.bytesFed += data.length
		if (this.terminal.lineCount > MAX_SCROLLBACK_LINES || this.bytesFed > MAX_BUFFER_BYTES) {
			this.terminal.reset()
			this.bytesFed = 0
			this.lineTimestamps = []
			this.lineCounter = 0
		}
		const now = Date.now()
		// Record timestamp for first line if we haven't yet
		if (this.lineCounter === 0) {
			this.lineTimestamps.push(now)
			this.lineCounter = 1
		}
		// Count newlines in the incoming data
		for (let i = 0; i < data.length; i++) {
			if (data[i] === 0x0a) {
				this.lineTimestamps.push(now)
				this.lineCounter++
			}
		}
		const text = this.decoder.decode(data, { stream: true })
		this.terminal.feed(text)
		if (this._timestampFormat) {
			this.updateTimestampSigns()
		}
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

	getText(): string {
		return this.terminal.getText()
	}

	onCopy(handler: (text: string) => void): void {
		this._onCopy = handler
	}

	onLinkClick(handler: (link: DetectedLink) => void): void {
		this._onLinkClick = handler
	}

	private getLinkAtMouse(localX: number, localY: number): DetectedLink | null {
		const text = this.terminal.getText()
		const lines = text.split('\n')
		const lineIndex = Math.floor(this.scrollBox.scrollTop) + localY
		if (lineIndex < 0 || lineIndex >= lines.length) return null
		return findLinkAtPosition(lines[lineIndex], localX)
	}

	show(): void {
		this.scrollBox.visible = true
	}

	hide(): void {
		this.scrollBox.visible = false
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
		this.bytesFed = 0
		this.lineTimestamps = []
		this.lineCounter = 0
		if (this._timestampFormat) {
			this.timestampGutter?.clearAllLineSigns()
		}
	}

	/** Enable or disable the timestamp gutter. Pass `true` for default format, a string for custom format, or `false` to disable. */
	setTimestamps(value: boolean | string): void {
		const newFormat = !value ? null : typeof value === 'string' ? value : DEFAULT_TIMESTAMP_FORMAT
		const wasEnabled = this._timestampFormat !== null
		const isEnabled = newFormat !== null

		if (wasEnabled === isEnabled && this._timestampFormat === newFormat) return
		this._timestampFormat = newFormat

		if (isEnabled && !wasEnabled) {
			// Wrap terminal in LineNumberRenderable for gutter + scroll sync
			this.scrollBox.remove(this.terminal.id)
			const gutterWidth = (newFormat?.length ?? 8) + 1
			this.timestampGutter = new LineNumberRenderable(this.renderer, {
				id: `ts-${this.terminal.id}`,
				target: this.terminal,
				showLineNumbers: false,
				minWidth: gutterWidth,
				paddingRight: 0,
				fg: '#666666'
			})
			this.scrollBox.add(this.timestampGutter)
			this.updateTimestampSigns()
		} else if (!isEnabled && wasEnabled) {
			// Unwrap: detach terminal from gutter, add directly to scrollBox
			if (this.timestampGutter) {
				this.timestampGutter.clearTarget()
				this.scrollBox.remove(this.timestampGutter.id)
				this.timestampGutter = null
			}
			this.scrollBox.add(this.terminal)
		} else if (isEnabled) {
			// Format changed while enabled — update signs
			this.updateTimestampSigns()
		}
	}

	get timestampsEnabled(): boolean {
		return this._timestampFormat !== null
	}

	private updateTimestampSigns(): void {
		if (!(this.timestampGutter && this._timestampFormat)) return
		const fmt = this._timestampFormat
		const signs = new Map<number, LineSign>()
		let prevFormatted = ''
		for (let i = 0; i < this.lineTimestamps.length; i++) {
			const formatted = formatTimestamp(new Date(this.lineTimestamps[i]), fmt)
			// Only show timestamp when it changes from the previous line
			if (formatted !== prevFormatted) {
				signs.set(i, { before: formatted })
				prevFormatted = formatted
			}
		}
		this.timestampGutter.setLineSigns(signs)
	}

	destroy(): void {
		this.terminal.destroy()
	}
}
