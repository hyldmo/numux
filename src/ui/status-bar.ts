import {
	BoxRenderable,
	type CliRenderer,
	cyan,
	red,
	reverse,
	StyledText,
	type TextChunk,
	TextRenderable,
	yellow
} from '@opentui/core'
import { DARK_THEME, type Theme } from '../utils/theme'
import { STATUS_BAR_TEXT } from './keybindings'

function plain(text: string): TextChunk {
	return { __isChunk: true, text } as TextChunk
}

export class StatusBar {
	readonly renderable: BoxRenderable
	private text: TextRenderable
	private _searchMode = false
	private _searchQuery = ''
	private _searchMatchCount = 0
	private _searchCurrentIndex = -1
	private _crossProcessInfo?: { totalMatches: number; processCount: number }
	private _tempMessage: string | null = null
	private _tempTimer: ReturnType<typeof setTimeout> | null = null
	private _inputMode = false

	constructor(renderer: CliRenderer, theme: Theme = DARK_THEME) {
		this.renderable = new BoxRenderable(renderer, {
			id: 'status-bar',
			width: '100%',
			backgroundColor: theme.statusBarBg,
			paddingX: 1,
			minHeight: 1
		})

		this.text = new TextRenderable(renderer, {
			id: 'status-bar-text',
			width: '100%',
			wrapMode: 'word',
			fg: theme.statusBarText,
			content: this.buildContent()
		})
		this.text.selectable = false

		this.renderable.add(this.text)
	}

	setSearchMode(
		active: boolean,
		query = '',
		matchCount = 0,
		currentIndex = -1,
		crossProcessInfo?: { totalMatches: number; processCount: number }
	): void {
		this._searchMode = active
		this._searchQuery = query
		this._searchMatchCount = matchCount
		this._searchCurrentIndex = currentIndex
		this._crossProcessInfo = crossProcessInfo
		this.text.content = this.buildContent()
	}

	showTemporaryMessage(message: string, duration = 2000): void {
		if (this._tempTimer) clearTimeout(this._tempTimer)
		this._tempMessage = message
		this.text.content = this.buildContent()
		this._tempTimer = setTimeout(() => {
			this._tempMessage = null
			this._tempTimer = null
			this.text.content = this.buildContent()
		}, duration)
	}

	setInputMode(active: boolean): void {
		this._inputMode = active
		this.text.content = this.buildContent()
	}

	private buildContent(): StyledText {
		if (this._tempMessage) {
			return new StyledText([cyan(this._tempMessage)])
		}
		if (this._searchMode) {
			return this.buildSearchContent()
		}
		if (this._inputMode) {
			return new StyledText([yellow('INPUT'), plain('  Type to send input to process.  '), plain('Esc: exit')])
		}
		return new StyledText([plain(STATUS_BAR_TEXT)])
	}

	private buildSearchContent(): StyledText {
		const chunks: TextChunk[] = []
		const isAllMode = !!this._crossProcessInfo
		chunks.push(yellow('/'))
		if (this._searchQuery) chunks.push(plain(this._searchQuery))
		chunks.push(reverse(' '))
		if (this._searchMatchCount === 0 && this._searchQuery) {
			chunks.push(plain('  '))
			chunks.push(red('no matches'))
		} else if (this._searchMatchCount > 0) {
			chunks.push(plain('  '))
			if (isAllMode) {
				const { totalMatches, processCount } = this._crossProcessInfo!
				chunks.push(cyan(`${this._searchCurrentIndex + 1}/${this._searchMatchCount}`))
				chunks.push(plain(`  ${totalMatches} in ${processCount} process${processCount === 1 ? '' : 'es'}`))
			} else {
				chunks.push(cyan(`${this._searchCurrentIndex + 1}/${this._searchMatchCount}`))
			}
			chunks.push(plain('  Enter: next'))
		} else {
			chunks.push(plain('  Enter: next'))
		}
		chunks.push(plain(`  Tab: ${isAllMode ? 'single' : 'all'}  Esc: close`))
		return new StyledText(chunks)
	}
}
