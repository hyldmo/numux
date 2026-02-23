import {
	type CliRenderer,
	cyan,
	fg,
	green,
	red,
	reverse,
	StyledText,
	type TextChunk,
	TextRenderable,
	yellow
} from '@opentui/core'
import type { ProcessStatus } from '../types'

const STATUS_STYLE: Partial<Record<ProcessStatus, (input: string) => TextChunk>> = {
	ready: green,
	running: cyan,
	finished: green,
	failed: red,
	stopped: fg('#888'),
	skipped: fg('#888')
}

function plain(text: string): TextChunk {
	return { __isChunk: true, text } as TextChunk
}

export class StatusBar {
	readonly renderable: TextRenderable
	private statuses = new Map<string, ProcessStatus>()
	private colors: Map<string, string>
	private scrolledUp = false
	private _searchMode = false
	private _searchQuery = ''
	private _searchMatchCount = 0
	private _searchCurrentIndex = -1

	constructor(renderer: CliRenderer, names: string[], colors?: Map<string, string>) {
		this.colors = colors ?? new Map()
		for (const name of names) {
			this.statuses.set(name, 'pending')
		}

		this.renderable = new TextRenderable(renderer, {
			id: 'status-bar',
			width: '100%',
			height: 1,
			content: this.buildContent(),
			bg: '#1a1a1a',
			paddingX: 1
		})
	}

	updateStatus(name: string, status: ProcessStatus): void {
		this.statuses.set(name, status)
		this.renderable.content = this.buildContent()
	}

	setScrollIndicator(scrolledUp: boolean): void {
		if (this.scrolledUp === scrolledUp) return
		this.scrolledUp = scrolledUp
		this.renderable.content = this.buildContent()
	}

	setSearchMode(active: boolean, query = '', matchCount = 0, currentIndex = -1): void {
		this._searchMode = active
		this._searchQuery = query
		this._searchMatchCount = matchCount
		this._searchCurrentIndex = currentIndex
		this.renderable.content = this.buildContent()
	}

	private buildContent(): StyledText {
		if (this._searchMode) {
			return this.buildSearchContent()
		}
		const chunks: TextChunk[] = []
		let first = true
		for (const [name, status] of this.statuses) {
			if (!first) chunks.push(plain('  '))
			first = false
			const styleFn = STATUS_STYLE[status]
			const hexColor = this.colors.get(name)
			if (styleFn) {
				chunks.push(styleFn(`${name}:${status}`))
			} else if (hexColor) {
				chunks.push(fg(hexColor)(`${name}:${status}`))
			} else {
				chunks.push(plain(`${name}:${status}`))
			}
		}
		if (this.scrolledUp) {
			chunks.push(plain('  '))
			chunks.push(yellow('[scrolled]'))
		}
		chunks.push(
			plain('  Alt+\u2190\u2192/1-9: tabs  Alt+PgUp/Dn: scroll  Alt+R: restart  Alt+S: stop/start  Ctrl+C: quit')
		)
		return new StyledText(chunks)
	}

	private buildSearchContent(): StyledText {
		const chunks: TextChunk[] = []
		chunks.push(yellow('/'))
		if (this._searchQuery) chunks.push(plain(this._searchQuery))
		chunks.push(reverse(' '))
		if (this._searchMatchCount === 0 && this._searchQuery) {
			chunks.push(plain('  '))
			chunks.push(red('no matches'))
			chunks.push(plain('  Esc: close'))
		} else if (this._searchMatchCount > 0) {
			chunks.push(plain('  '))
			chunks.push(cyan(`${this._searchCurrentIndex + 1}/${this._searchMatchCount}`))
			chunks.push(plain('  Enter/Shift+Enter: next/prev  Esc: close'))
		} else {
			chunks.push(plain('  Enter: next  Esc: close'))
		}
		return new StyledText(chunks)
	}
}
