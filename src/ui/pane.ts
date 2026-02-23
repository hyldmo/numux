import { type CliRenderer, ScrollBoxRenderable } from '@opentui/core'
import { GhosttyTerminalRenderable } from 'ghostty-opentui/terminal-buffer'

export class Pane {
	readonly scrollBox: ScrollBoxRenderable
	readonly terminal: GhosttyTerminalRenderable
	private decoder = new TextDecoder()

	constructor(renderer: CliRenderer, name: string, cols: number, rows: number) {
		this.scrollBox = new ScrollBoxRenderable(renderer, {
			id: `pane-${name}`,
			flexGrow: 1,
			width: '100%',
			stickyScroll: true,
			stickyStart: 'bottom',
			visible: false
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

	scrollBy(delta: number): void {
		this.scrollBox.scrollBy(delta)
	}

	scrollToTop(): void {
		this.scrollBox.scrollTo(0)
	}

	scrollToBottom(): void {
		this.scrollBox.scrollTo(this.scrollBox.scrollHeight)
	}

	show(): void {
		this.scrollBox.visible = true
	}

	hide(): void {
		this.scrollBox.visible = false
	}

	clear(): void {
		this.terminal.reset()
	}

	destroy(): void {
		this.terminal.destroy()
	}
}
