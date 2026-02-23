import { BoxRenderable, type CliRenderer, createCliRenderer } from '@opentui/core'
import type { ProcessManager } from '../process/manager'
import type { ResolvedNumuxConfig } from '../types'
import { hexToAnsi } from '../utils/color'
import { Pane, type SearchMatch } from './pane'
import { StatusBar } from './status-bar'
import { TabBar } from './tabs'

/** Default palette for processes without an explicit color */
const DEFAULT_COLORS = ['\x1b[36m', '\x1b[33m', '\x1b[35m', '\x1b[34m', '\x1b[32m', '\x1b[91m', '\x1b[93m', '\x1b[95m']

export class App {
	private renderer!: CliRenderer
	private manager: ProcessManager
	private panes = new Map<string, Pane>()
	private tabBar!: TabBar
	private statusBar!: StatusBar
	private activePane: string | null = null
	private destroyed = false
	private names: string[]
	private termCols = 80
	private termRows = 24

	private processColors: Map<string, string>

	// Search state
	private searchMode = false
	private searchQuery = ''
	private searchMatches: SearchMatch[] = []
	private searchIndex = -1

	constructor(manager: ProcessManager, config: ResolvedNumuxConfig) {
		this.manager = manager
		this.names = manager.getProcessNames()
		this.processColors = this.buildColorMap(config)
	}

	private buildColorMap(config: ResolvedNumuxConfig): Map<string, string> {
		const map = new Map<string, string>()
		let paletteIndex = 0
		for (const name of this.names) {
			const explicit = config.processes[name]?.color
			if (explicit) {
				map.set(name, hexToAnsi(explicit))
			} else {
				map.set(name, DEFAULT_COLORS[paletteIndex % DEFAULT_COLORS.length])
				paletteIndex++
			}
		}
		return map
	}

	async start(): Promise<void> {
		this.renderer = await createCliRenderer({
			exitOnCtrlC: false,
			useMouse: true
		})

		const { width, height } = this.renderer
		this.termCols = Math.max(40, width - 2)
		this.termRows = Math.max(5, height - 5)
		const { termCols, termRows } = this

		// Layout root
		const layout = new BoxRenderable(this.renderer, {
			id: 'root',
			flexDirection: 'column',
			width: '100%',
			height: '100%',
			border: false
		})

		// Tab bar
		this.tabBar = new TabBar(this.renderer, this.names, this.processColors)

		// Pane container
		const paneContainer = new BoxRenderable(this.renderer, {
			id: 'pane-container',
			flexGrow: 1,
			width: '100%',
			border: false
		})

		// Create a pane per process
		for (const name of this.names) {
			const pane = new Pane(this.renderer, name, termCols, termRows)
			pane.onScroll(() => {
				if (name === this.activePane) this.updateScrollIndicator()
			})
			this.panes.set(name, pane)
			paneContainer.add(pane.scrollBox)
		}

		// Status bar
		this.statusBar = new StatusBar(this.renderer, this.names, this.processColors)

		// Assemble layout
		layout.add(this.tabBar.renderable)
		layout.add(paneContainer)
		layout.add(this.statusBar.renderable)
		this.renderer.root.add(layout)

		// Wire tab events (mouse clicks)
		this.tabBar.onSelect((_index, name) => this.switchPane(name))
		this.tabBar.onSelectionChanged((_index, name) => this.switchPane(name))

		// Wire process events
		this.manager.on(event => {
			if (this.destroyed) return
			if (event.type === 'output') {
				this.panes.get(event.name)?.feed(event.data)
				if (event.name === this.activePane) {
					this.updateScrollIndicator()
				}
			} else if (event.type === 'status') {
				this.tabBar.updateStatus(event.name, event.status)
				this.statusBar.updateStatus(event.name, event.status)
			}
		})

		// Handle resize
		this.renderer.on('resize', (w: number, h: number) => {
			this.termCols = Math.max(40, w - 2)
			this.termRows = Math.max(5, h - 5)
			for (const pane of this.panes.values()) {
				pane.resize(this.termCols, this.termRows)
			}
			this.manager.resizeAll(this.termCols, this.termRows)
		})

		// Global keyboard handler
		this.renderer.keyInput.on(
			'keypress',
			(key: { ctrl: boolean; shift: boolean; meta: boolean; name: string; sequence: string }) => {
				// Ctrl+C: quit (always works)
				if (key.ctrl && key.name === 'c') {
					if (this.searchMode) {
						this.exitSearch()
						return
					}
					this.shutdown()
					return
				}

				// Search mode input handling
				if (this.searchMode) {
					this.handleSearchInput(key)
					return
				}

				if (key.meta && !key.ctrl && !key.shift) {
					// Alt+F: enter search mode
					if (key.name === 'f' && this.activePane) {
						this.enterSearch()
						return
					}

					// Alt+R: restart active process
					if (key.name === 'r' && this.activePane) {
						this.manager.restart(this.activePane, this.termCols, this.termRows)
						return
					}

					// Alt+L: clear active pane
					if (key.name === 'l' && this.activePane) {
						this.panes.get(this.activePane)?.clear()
						return
					}

					// Alt+1-9: jump to tab
					const num = Number.parseInt(key.name, 10)
					if (num >= 1 && num <= 9 && num <= this.names.length) {
						this.tabBar.setSelectedIndex(num - 1)
						this.switchPane(this.names[num - 1])
						return
					}

					// Alt+Left/Right: cycle tabs
					if (key.name === 'left' || key.name === 'right') {
						const current = this.tabBar.getSelectedIndex()
						const next =
							key.name === 'right'
								? (current + 1) % this.names.length
								: (current - 1 + this.names.length) % this.names.length
						this.tabBar.setSelectedIndex(next)
						this.switchPane(this.names[next])
						return
					}

					// Alt+PageUp/PageDown: scroll output
					if (this.activePane && (key.name === 'pageup' || key.name === 'pagedown')) {
						const pane = this.panes.get(this.activePane)
						const delta = this.termRows - 2
						pane?.scrollBy(key.name === 'pageup' ? -delta : delta)
						this.updateScrollIndicator()
						return
					}

					// Alt+Home/End: scroll to top/bottom
					if (this.activePane && key.name === 'home') {
						this.panes.get(this.activePane)?.scrollToTop()
						this.updateScrollIndicator()
						return
					}
					if (this.activePane && key.name === 'end') {
						this.panes.get(this.activePane)?.scrollToBottom()
						this.updateScrollIndicator()
						return
					}
				}

				// Forward all other input to the active process
				if (this.activePane && key.sequence) {
					this.manager.write(this.activePane, key.sequence)
				}
			}
		)

		// Show first pane
		if (this.names.length > 0) {
			this.switchPane(this.names[0])
		}

		// Start all processes
		this.manager.startAll(termCols, termRows)
	}

	private switchPane(name: string): void {
		if (this.activePane === name) return
		// Clear search when switching panes
		if (this.searchMode) {
			this.exitSearch()
		}
		if (this.activePane) {
			this.panes.get(this.activePane)?.hide()
		}
		this.activePane = name
		this.panes.get(name)?.show()
		this.updateScrollIndicator()
	}

	private updateScrollIndicator(): void {
		if (!this.activePane) return
		const pane = this.panes.get(this.activePane)
		if (!pane) return
		this.statusBar.setScrollIndicator(!pane.isAtBottom)
	}

	private enterSearch(): void {
		this.searchMode = true
		this.searchQuery = ''
		this.searchMatches = []
		this.searchIndex = -1
		this.statusBar.setSearchMode(true)
	}

	private exitSearch(): void {
		this.searchMode = false
		this.searchQuery = ''
		this.searchMatches = []
		this.searchIndex = -1
		if (this.activePane) {
			this.panes.get(this.activePane)?.clearHighlights()
		}
		this.statusBar.setSearchMode(false)
	}

	private handleSearchInput(key: {
		ctrl: boolean
		shift: boolean
		meta: boolean
		name: string
		sequence: string
	}): void {
		if (key.name === 'escape') {
			this.exitSearch()
			return
		}

		if (key.name === 'return') {
			// Enter: next match, Shift+Enter: previous match
			if (this.searchMatches.length === 0) return
			if (key.shift) {
				this.searchIndex = (this.searchIndex - 1 + this.searchMatches.length) % this.searchMatches.length
			} else {
				this.searchIndex = (this.searchIndex + 1) % this.searchMatches.length
			}
			this.scrollToCurrentMatch()
			this.updateSearchHighlights()
			return
		}

		if (key.name === 'backspace') {
			if (this.searchQuery.length > 0) {
				this.searchQuery = this.searchQuery.slice(0, -1)
				this.runSearch()
			}
			return
		}

		// Printable character
		if (key.sequence && key.sequence.length === 1 && !key.ctrl && !key.meta) {
			this.searchQuery += key.sequence
			this.runSearch()
		}
	}

	private runSearch(): void {
		if (!this.activePane) return
		const pane = this.panes.get(this.activePane)
		if (!pane) return

		this.searchMatches = pane.search(this.searchQuery)
		this.searchIndex = this.searchMatches.length > 0 ? 0 : -1

		this.updateSearchHighlights()
		if (this.searchIndex >= 0) {
			this.scrollToCurrentMatch()
		}
	}

	private updateSearchHighlights(): void {
		if (!this.activePane) return
		const pane = this.panes.get(this.activePane)
		if (!pane) return

		if (this.searchMatches.length > 0) {
			pane.setHighlights(this.searchMatches, this.searchIndex)
		} else {
			pane.clearHighlights()
		}
		this.statusBar.setSearchMode(true, this.searchQuery, this.searchMatches.length, this.searchIndex)
	}

	private scrollToCurrentMatch(): void {
		if (!this.activePane || this.searchIndex < 0) return
		const pane = this.panes.get(this.activePane)
		if (!pane) return
		const match = this.searchMatches[this.searchIndex]
		pane.scrollToLine(match.line)
		this.updateScrollIndicator()
	}

	async shutdown(): Promise<void> {
		if (this.destroyed) return
		this.destroyed = true
		await this.manager.stopAll()
		for (const pane of this.panes.values()) {
			pane.destroy()
		}
		if (!this.renderer.isDestroyed) {
			this.renderer.destroy()
		}
		process.exit(0)
	}
}

