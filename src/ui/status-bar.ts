import { type CliRenderer, TextRenderable } from '@opentui/core'
import type { ProcessStatus } from '../types'
import { ANSI_RESET, STATUS_ANSI } from '../utils/color'

const RESET = ANSI_RESET

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

	private buildContent(): string {
		if (this._searchMode) {
			return this.buildSearchContent()
		}
		const parts: string[] = []
		for (const [name, status] of this.statuses) {
			const ansi = STATUS_ANSI[status] ?? this.colors.get(name)
			if (ansi) {
				parts.push(`${ansi}${name}:${status}${RESET}`)
			} else {
				parts.push(`${name}:${status}`)
			}
		}
		const scroll = this.scrolledUp ? `  \x1b[33m[scrolled]\x1b[0m` : ''
		return `${parts.join('  ')}${scroll}  Alt+←→/1-9: tabs  Alt+PgUp/Dn: scroll  Alt+R: restart  Alt+S: stop/start  Ctrl+C: quit`
	}

	private buildSearchContent(): string {
		const cursor = '\x1b[7m \x1b[0m'
		const query = `\x1b[33m/${RESET}${this._searchQuery}${cursor}`
		if (this._searchMatchCount === 0 && this._searchQuery) {
			return `${query}  \x1b[31mno matches${RESET}  Esc: close`
		}
		if (this._searchMatchCount > 0) {
			return `${query}  \x1b[36m${this._searchCurrentIndex + 1}/${this._searchMatchCount}${RESET}  Enter/Shift+Enter: next/prev  Esc: close`
		}
		return `${query}  Enter: next  Esc: close`
	}
}
