import type { KeyEvent } from '../types'
import type { CrossProcessMatch, LogWriter } from '../utils/log-writer'
import type { Pane, SearchMatch } from './pane'
import type { StatusBar } from './status-bar'
import type { TabBar } from './tabs'

/** Owns all search state and logic, keeping App lightweight. */
export class SearchController {
	private mode = false
	private allMode = false
	private query = ''
	private matches: SearchMatch[] = []
	private index = -1
	private crossMatches: CrossProcessMatch[] = []
	private crossCounts = new Map<string, number>()
	private timer: ReturnType<typeof setTimeout> | null = null

	private logWriter: LogWriter
	private statusBar: StatusBar
	private tabBar: TabBar
	private getActivePane: () => string | null
	private getPane: (name: string) => Pane | undefined

	constructor(opts: {
		logWriter: LogWriter
		statusBar: StatusBar
		tabBar: TabBar
		getActivePane: () => string | null
		getPane: (name: string) => Pane | undefined
	}) {
		this.logWriter = opts.logWriter
		this.statusBar = opts.statusBar
		this.tabBar = opts.tabBar
		this.getActivePane = opts.getActivePane
		this.getPane = opts.getPane
	}

	get isActive(): boolean {
		return this.mode
	}

	get isAllMode(): boolean {
		return this.allMode
	}

	get currentMatches(): SearchMatch[] {
		return this.matches
	}

	enter(): void {
		this.mode = true
		this.query = ''
		this.matches = []
		this.index = -1
		this.allMode = false
		this.crossMatches = []
		this.crossCounts.clear()
		this.statusBar.setSearchMode(true)
	}

	exit(): void {
		this.mode = false
		this.query = ''
		this.matches = []
		this.index = -1
		this.allMode = false
		this.crossMatches = []
		this.crossCounts.clear()
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
		const active = this.getActivePane()
		if (active) {
			this.getPane(active)?.clearHighlights()
		}
		this.tabBar.clearSearchMatches()
		this.statusBar.setSearchMode(false)
	}

	/** Called by App when the active pane changes during all-process search. */
	onPaneSwitch(): void {
		if (this.mode && this.allMode) {
			this.applyPaneMatches()
		}
	}

	/** Called when the pane scrolls to refresh visible highlights. */
	refreshHighlights(): void {
		if (this.matches.length > 0) {
			this.updateHighlights()
		}
	}

	handleInput(key: KeyEvent): void {
		if (key.name === 'escape') {
			this.exit()
			return
		}

		if (key.name === 'tab') {
			this.allMode = !this.allMode
			if (!this.allMode) {
				this.crossMatches = []
				this.crossCounts.clear()
				this.tabBar.clearSearchMatches()
			}
			this.scheduleSearch()
			return
		}

		if (key.name === 'return') {
			if (this.matches.length === 0) return
			if (key.shift) {
				this.index = (this.index - 1 + this.matches.length) % this.matches.length
			} else {
				this.index = (this.index + 1) % this.matches.length
			}
			this.scrollToMatch()
			this.updateHighlights()
			return
		}

		if (key.name === 'backspace') {
			if (this.query.length > 0) {
				this.query = this.query.slice(0, -1)
				this.scheduleSearch()
			}
			return
		}

		if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
			this.query += key.sequence
			this.scheduleSearch()
		}
	}

	dispose(): void {
		if (this.timer) {
			clearTimeout(this.timer)
			this.timer = null
		}
	}

	private scheduleSearch(): void {
		this.statusBar.setSearchMode(true, this.query, this.matches.length, this.index, this.crossInfo())
		if (this.timer) clearTimeout(this.timer)
		this.timer = setTimeout(() => {
			this.timer = null
			this.runSearch()
		}, 100)
	}

	private async runSearch(): Promise<void> {
		const active = this.getActivePane()
		if (!active) return

		const query = this.query
		const allMode = this.allMode

		if (allMode) {
			const allMatches = await this.logWriter.searchAll(query)
			if (!this.mode || this.query !== query || !this.allMode) return

			this.crossMatches = allMatches
			this.crossCounts.clear()
			for (const m of allMatches) {
				this.crossCounts.set(m.process, (this.crossCounts.get(m.process) ?? 0) + 1)
			}
			this.tabBar.setSearchMatches(this.crossCounts)
			this.applyPaneMatches()
		} else {
			const matches = await this.logWriter.search(active, query)
			if (!this.mode || this.query !== query || this.getActivePane() !== active) return

			this.matches = matches
			this.index = matches.length > 0 ? 0 : -1
			this.updateHighlights()
			if (this.index >= 0) this.scrollToMatch()
		}
	}

	private applyPaneMatches(): void {
		const active = this.getActivePane()
		if (!active) return
		const paneMatches = this.crossMatches
			.filter(m => m.process === active)
			.map(({ line, start, end }) => ({ line, start, end }))

		this.matches = paneMatches
		this.index = paneMatches.length > 0 ? 0 : -1
		this.updateHighlights()
		if (this.index >= 0) this.scrollToMatch()
	}

	private updateHighlights(): void {
		const active = this.getActivePane()
		if (!active) return
		const pane = this.getPane(active)
		if (!pane) return

		if (this.matches.length > 0) {
			pane.setHighlights(this.matches, this.index)
		} else {
			pane.clearHighlights()
		}
		this.statusBar.setSearchMode(true, this.query, this.matches.length, this.index, this.crossInfo())
	}

	private scrollToMatch(): void {
		const active = this.getActivePane()
		if (!active || this.index < 0) return
		const pane = this.getPane(active)
		if (!pane) return
		pane.scrollToLine(this.matches[this.index].line)
	}

	private crossInfo(): { totalMatches: number; processCount: number } | undefined {
		return this.allMode
			? { totalMatches: this.crossMatches.length, processCount: this.crossCounts.size }
			: undefined
	}
}
