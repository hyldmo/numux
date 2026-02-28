import { BoxRenderable, type CliRenderer, createCliRenderer } from '@opentui/core'
import type { ProcessManager } from '../process/manager'
import type { KeyEvent, ResolvedNumuxConfig } from '../types'
import { buildProcessHexColorMap } from '../utils/color'
import type { LogWriter } from '../utils/log-writer'
import { log } from '../utils/logger'
import { SHORTCUTS } from './keybindings'
import { Pane } from './pane'
import { SearchController } from './search'
import { StatusBar } from './status-bar'
import { TabBar } from './tabs'
import { openLink } from './url-handler'

export class App {
	private renderer!: CliRenderer
	private manager: ProcessManager
	private panes = new Map<string, Pane>()
	private tabBar!: TabBar
	private statusBar!: StatusBar
	private search!: SearchController
	private activePane: string | null = null
	private destroyed = false
	private names: string[]
	private termCols = 80
	private termRows = 24
	private sidebarWidth = 20

	private config: ResolvedNumuxConfig
	private logWriter: LogWriter

	private resizeTimer: ReturnType<typeof setTimeout> | null = null

	// Input-waiting detection for interactive processes
	private inputWaitTimers = new Map<string, ReturnType<typeof setTimeout>>()
	private awaitingInput = new Set<string>()

	constructor(manager: ProcessManager, config: ResolvedNumuxConfig, logWriter: LogWriter) {
		this.manager = manager
		this.config = config
		this.logWriter = logWriter
		this.names = manager.getProcessNames()
	}

	async start(): Promise<void> {
		this.renderer = await createCliRenderer({
			exitOnCtrlC: false,
			useMouse: true,
			useKittyKeyboard: {}
		})

		const { width, height } = this.renderer
		const maxNameLen = Math.max(...this.names.map(n => n.length))
		this.sidebarWidth = Math.min(30, Math.max(16, maxNameLen + 5))
		this.termCols = Math.max(40, width - this.sidebarWidth - 2)
		this.termRows = Math.max(5, height - 2)
		const { termCols, termRows } = this

		// Layout root
		const layout = new BoxRenderable(this.renderer, {
			id: 'root',
			flexDirection: 'column',
			width: '100%',
			height: '100%',
			border: false
		})

		// Tab bar (vertical sidebar)
		const processHexColors = buildProcessHexColorMap(this.names, this.config)
		this.tabBar = new TabBar(this.renderer, this.names, processHexColors)

		// Content row: sidebar | pane
		const contentRow = new BoxRenderable(this.renderer, {
			id: 'content-row',
			flexDirection: 'row',
			flexGrow: 1,
			width: '100%',
			border: false
		})

		const sidebar = new BoxRenderable(this.renderer, {
			id: 'sidebar',
			width: this.sidebarWidth,
			height: '100%',
			border: ['right'],
			borderColor: '#444'
		})
		sidebar.add(this.tabBar.renderable)

		// Pane container
		const paneContainer = new BoxRenderable(this.renderer, {
			id: 'pane-container',
			flexGrow: 1,
			border: false
		})

		// Status bar (only visible during search)
		this.statusBar = new StatusBar(this.renderer)

		// Search controller
		this.search = new SearchController({
			logWriter: this.logWriter,
			statusBar: this.statusBar,
			tabBar: this.tabBar,
			getActivePane: () => this.activePane,
			getPane: name => this.panes.get(name)
		})

		// Create a pane per process
		for (const name of this.names) {
			const interactive = this.config.processes[name].interactive === true
			const pane = new Pane(this.renderer, name, termCols, termRows, interactive)
			pane.onCopy(text => {
				this.copyToClipboard(text)
				this.statusBar.showTemporaryMessage('Copied!')
			})
			pane.onLinkClick(link => {
				openLink(link)
				this.statusBar.showTemporaryMessage(`Opening ${link.url}`)
			})
			pane.onScroll(() => {
				if (this.search.isActive && this.search.currentMatches.length > 0 && this.activePane === name) {
					this.search.refreshHighlights()
				}
			})
			this.panes.set(name, pane)
			paneContainer.add(pane.scrollBox)
		}

		// Assemble layout
		contentRow.add(sidebar)
		contentRow.add(paneContainer)
		layout.add(contentRow)
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
				// Detect input-waiting for interactive processes
				if (this.config.processes[event.name]?.interactive) {
					this.checkInputWaiting(event.name, event.data)
				}
			} else if (event.type === 'error') {
				this.tabBar.setError(event.name, true)
			} else if (event.type === 'status') {
				const state = this.manager.getState(event.name)
				this.tabBar.updateStatus(event.name, event.status, state?.exitCode, state?.restartCount)
				// Clear input-waiting on non-active statuses
				if (event.status !== 'running' && event.status !== 'ready') {
					this.clearInputWaiting(event.name)
				}
			}
		})

		// Handle resize (debounced to avoid excessive PTY resize calls)
		this.renderer.on('resize', (w: number, h: number) => {
			this.termCols = Math.max(40, w - this.sidebarWidth - 2)
			this.termRows = Math.max(5, h - 2)
			if (this.resizeTimer) clearTimeout(this.resizeTimer)
			this.resizeTimer = setTimeout(() => {
				this.resizeTimer = null
				for (const pane of this.panes.values()) {
					pane.resize(this.termCols, this.termRows)
				}
				this.manager.resizeAll(this.termCols, this.termRows)
			}, 50)
		})

		// Global keyboard handler
		this.renderer.keyInput.on('keypress', (key: KeyEvent) => {
			log(key)

			// Ctrl+C: quit (always works)
			if (key.ctrl && key.name === 'c') {
				if (this.search.isActive) {
					this.search.exit()
					return
				}
				this.shutdown().then(() => {
					process.exit(this.hasFailures() ? 1 : 0)
				})
				return
			}

			// Search mode input handling
			if (this.search.isActive) {
				this.search.handleInput(key)
				return
			}

			if (!this.activePane) return

			const isInteractive = this.config.processes[this.activePane]?.interactive === true

			// Non-interactive panes: plain keys act as shortcuts
			if (!isInteractive) {
				const name = key.name.toLowerCase()

				if (key.shift && name === SHORTCUTS.scrollToBottom.key) {
					this.panes.get(this.activePane)?.scrollToBottom()
					return
				}

				if (name === SHORTCUTS.scrollToTop.key) {
					this.panes.get(this.activePane)?.scrollToTop()
					return
				}

				if (key.shift && name === SHORTCUTS.restartAll.key) {
					this.manager.restartAll(this.termCols, this.termRows)
					return
				}

				if (name === SHORTCUTS.copy.key) {
					this.copyAllText()
					return
				}

				if (name === SHORTCUTS.search.key) {
					this.search.enter()
					return
				}

				if (name === SHORTCUTS.restart.key) {
					this.manager.restart(this.activePane, this.termCols, this.termRows)
					return
				}

				if (name === SHORTCUTS.stopStart.key) {
					const state = this.manager.getState(this.activePane)
					if (state?.status === 'stopped' || state?.status === 'finished' || state?.status === 'failed') {
						this.manager.start(this.activePane, this.termCols, this.termRows)
					} else {
						this.manager.stop(this.activePane)
					}
					return
				}

				if (name === SHORTCUTS.clear.key) {
					this.panes.get(this.activePane)?.clear()
					this.logWriter.truncate(this.activePane)
					return
				}

				// 1-9: jump to tab (uses display order from tab bar)
				const num = Number.parseInt(name, 10)
				if (num >= 1 && num <= 9 && num <= this.tabBar.count) {
					this.tabBar.setSelectedIndex(num - 1)
					this.switchPane(this.tabBar.getNameAtIndex(num - 1))
					return
				}

				// Left/Right: cycle tabs
				if (name === 'left' || name === 'right') {
					const current = this.tabBar.getSelectedIndex()
					const count = this.tabBar.count
					const next = name === 'right' ? (current + 1) % count : (current - 1 + count) % count
					this.tabBar.setSelectedIndex(next)
					this.switchPane(this.tabBar.getNameAtIndex(next))
					return
				}

				// PageUp/PageDown: scroll by page
				if (name === 'pageup' || name === 'pagedown') {
					const pane = this.panes.get(this.activePane)
					const delta = this.termRows - 2
					pane?.scrollBy(name === 'pageup' ? -delta : delta)
					return
				}

				// Home/End: scroll to top/bottom
				if (name === 'home') {
					this.panes.get(this.activePane)?.scrollToTop()
					return
				}
				if (name === 'end') {
					this.panes.get(this.activePane)?.scrollToBottom()
					return
				}
				return
			}

			// Forward all other input to the active process (interactive mode)
			if (key.sequence) {
				this.manager.write(this.activePane, key.sequence)
			}
		})

		// Show first pane and focus sidebar for keyboard navigation
		if (this.names.length > 0) {
			this.switchPane(this.names[0])
			this.tabBar.focus()
		}

		// Start all processes
		await this.manager.startAll(termCols, termRows)
	}

	private switchPane(name: string): void {
		if (this.activePane === name) return
		// In single-pane search mode, exit search on pane switch
		if (this.search.isActive && !this.search.isAllMode) {
			this.search.exit()
		}
		if (this.activePane) {
			this.panes.get(this.activePane)?.clearHighlights()
			this.panes.get(this.activePane)?.hide()
		}
		this.activePane = name
		this.panes.get(name)?.show()
		// In all-process search mode, re-highlight for the new pane
		this.search.onPaneSwitch()
	}

	/** Detect when an interactive process is likely waiting for user input */
	private checkInputWaiting(name: string, data: Uint8Array): void {
		// Clear existing timer
		const existing = this.inputWaitTimers.get(name)
		if (existing) clearTimeout(existing)

		// If we were showing awaiting input, clear it since new output arrived
		if (this.awaitingInput.has(name)) {
			this.awaitingInput.delete(name)
			this.tabBar.setInputWaiting(name, false)
		}

		// If the last byte is not a newline, the process may be showing a prompt
		const lastByte = data[data.length - 1]
		if (lastByte !== 0x0a && lastByte !== 0x0d) {
			const timer = setTimeout(() => {
				this.inputWaitTimers.delete(name)
				const state = this.manager.getState(name)
				if (state && (state.status === 'running' || state.status === 'ready')) {
					this.awaitingInput.add(name)
					this.tabBar.setInputWaiting(name, true)
				}
			}, 200)
			this.inputWaitTimers.set(name, timer)
		}
	}

	private clearInputWaiting(name: string): void {
		const timer = this.inputWaitTimers.get(name)
		if (timer) {
			clearTimeout(timer)
			this.inputWaitTimers.delete(name)
		}
		if (this.awaitingInput.has(name)) {
			this.awaitingInput.delete(name)
			this.tabBar.setInputWaiting(name, false)
		}
	}

	/** Copy text to system clipboard via native CLI tool, with OSC 52 as fallback. */
	private copyToClipboard(text: string): void {
		this.renderer.copyToClipboardOSC52(text)
		const cmd =
			process.platform === 'darwin'
				? 'pbcopy'
				: process.platform === 'linux'
					? 'xclip -selection clipboard'
					: null
		if (cmd) {
			const [bin, ...args] = cmd.split(' ')
			try {
				const proc = Bun.spawn([bin, ...args], { stdin: 'pipe' })
				proc.stdin.write(text)
				proc.stdin.end()
				proc.exited.catch(() => {
					/* ignore */
				})
			} catch {
				// Native clipboard tool not available, OSC 52 is the fallback
			}
		}
	}

	/** Copy all text in the active pane to clipboard. */
	private copyAllText(): void {
		if (!this.activePane) return
		const pane = this.panes.get(this.activePane)
		if (!pane) return

		const text = pane.getText()
		if (!text) {
			this.statusBar.showTemporaryMessage('No output to copy')
			return
		}
		this.copyToClipboard(text)
		this.statusBar.showTemporaryMessage('Copied all output!')
	}

	async shutdown(): Promise<void> {
		if (this.destroyed) return
		this.destroyed = true
		if (this.resizeTimer) {
			clearTimeout(this.resizeTimer)
			this.resizeTimer = null
		}
		this.search.dispose()
		// Clear all input-waiting timers
		for (const timer of this.inputWaitTimers.values()) {
			clearTimeout(timer)
		}
		this.inputWaitTimers.clear()
		await this.manager.stopAll()
		for (const pane of this.panes.values()) {
			pane.destroy()
		}
		if (!this.renderer.isDestroyed) {
			this.renderer.destroy()
		}
	}

	/** Check if any process ended in a failed state */
	hasFailures(): boolean {
		return this.manager.getAllStates().some(s => s.status === 'failed')
	}
}
