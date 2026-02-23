import { type CliRenderer, cyan, red, reverse, StyledText, type TextChunk, TextRenderable, yellow } from '@opentui/core'
import { STATUS_BAR_TEXT } from './keybindings'

function plain(text: string): TextChunk {
	return { __isChunk: true, text } as TextChunk
}

export class StatusBar {
	readonly renderable: TextRenderable
	private _searchMode = false
	private _searchQuery = ''
	private _searchMatchCount = 0
	private _searchCurrentIndex = -1
	private _tempMessage: string | null = null
	private _tempTimer: ReturnType<typeof setTimeout> | null = null

	constructor(renderer: CliRenderer) {
		this.renderable = new TextRenderable(renderer, {
			id: 'status-bar',
			width: '100%',
			height: 1,
			content: this.buildContent(),
			bg: '#1a1a1a',
			paddingX: 1
		})
	}

	setSearchMode(active: boolean, query = '', matchCount = 0, currentIndex = -1): void {
		this._searchMode = active
		this._searchQuery = query
		this._searchMatchCount = matchCount
		this._searchCurrentIndex = currentIndex
		this.renderable.content = this.buildContent()
	}

	showTemporaryMessage(message: string, duration = 2000): void {
		if (this._tempTimer) clearTimeout(this._tempTimer)
		this._tempMessage = message
		this.renderable.content = this.buildContent()
		this._tempTimer = setTimeout(() => {
			this._tempMessage = null
			this._tempTimer = null
			this.renderable.content = this.buildContent()
		}, duration)
	}

	private buildContent(): StyledText {
		if (this._tempMessage) {
			return new StyledText([cyan(this._tempMessage)])
		}
		if (this._searchMode) {
			return this.buildSearchContent()
		}
		return new StyledText([plain(STATUS_BAR_TEXT)])
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
