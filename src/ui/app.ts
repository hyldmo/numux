import { BoxRenderable, type CliRenderer, createCliRenderer } from '@opentui/core'
import type { ProcessManager } from '../process/manager'
import type { KeyEvent, ResolvedNumuxConfig } from '../types'
import { buildProcessHexColorMap } from '../utils/color'
import type { LogWriter } from '../utils/log-writer'
import { log } from '../utils/logger'
import { finalizeShutdown } from '../utils/shutdown'
import { DARK_THEME, resolveTheme, type Theme } from '../utils/theme'
import { HelpOverlay } from './help-overlay'
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
	private helpOverlay!: HelpOverlay
	private search!: SearchController
	private activePane: string | null = null
	private inputMode = false
	private destroyed = false
	private names: string[]
	private termCols = 80
	private termRows = 24
	private sidebarWidth = 20

	private config: ResolvedNumuxConfig
	private logWriter: LogWriter
	private theme: Theme = DARK_THEME

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
		// Resolve theme before the renderer takes over stdin (OSC 11 needs raw stdin)
		log(
			`theme detect: pref=${this.config.theme ?? 'auto'} stdin.isTTY=${process.stdin.isTTY} stdout.isTTY=${process.stdout.isTTY} COLORFGBG=${process.env.COLORFGBG ?? '(unset)'}`
		)
		this.theme = await resolveTheme(this.config.theme)
		log(`theme resolved: ${this.theme.mode}`)

		this.renderer = await createCliRenderer({
			exitOnCtrlC: false,
			useMouse: true,
			useKittyKeyboard: {}
		})

		this.forceFullRepaints(this.renderer)

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
		const processHexColors = buildProcessHexColorMap(this.names, this.config, this.theme.palette)
		this.tabBar = new TabBar(this.renderer, this.names, processHexColors, this.theme, this.config.sort === 'status')

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
			borderColor: this.theme.sidebarBorder,
			backgroundColor: this.theme.sidebarBg
		})
		sidebar.add(this.tabBar.renderable)

		// Pane container
		const paneContainer = new BoxRenderable(this.renderer, {
			id: 'pane-container',
			flexGrow: 1,
			border: false
		})

		// Status bar
		this.statusBar = new StatusBar(this.renderer, this.theme)

		// Help overlay (hidden by default)
		this.helpOverlay = new HelpOverlay(this.renderer, this.theme)

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
			const pane = new Pane(this.renderer, name, termCols, termRows, interactive, this.theme)
			if (this.config.timestamps) {
				pane.setTimestamps(this.config.timestamps)
			}
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
		this.renderer.root.add(this.helpOverlay.renderable)

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

			// Ctrl+C: quit (always works, except in input mode where it goes to process)
			if (key.ctrl && key.name === 'c') {
				if (this.helpOverlay.isVisible) {
					this.helpOverlay.hide()
					return
				}
				if (this.inputMode) {
					this.exitInputMode()
					return
				}
				if (this.search.isActive) {
					this.search.exit()
					return
				}
				this.shutdown().then(() => {
					finalizeShutdown(this.logWriter, this.hasFailures() ? 1 : 0)
				})
				return
			}

			// Help overlay: ? toggles, Esc closes
			if (this.helpOverlay.isVisible) {
				if (key.name === 'escape' || key.sequence === '?' || key.name === 'h') {
					this.helpOverlay.hide()
				}
				return
			}

			// Search mode input handling
			if (this.search.isActive) {
				this.search.handleInput(key)
				return
			}

			// Input mode: forward keys to process, Escape exits
			if (this.inputMode && this.activePane) {
				if (key.name === 'escape') {
					this.exitInputMode()
					return
				}
				if (key.sequence) {
					this.manager.write(this.activePane, key.sequence)
				}
				return
			}

			if (!this.activePane) return

			const isInteractive = this.config.processes[this.activePane]?.interactive === true

			// Non-interactive panes: plain keys act as shortcuts
			if (!isInteractive) {
				const name = key.name.toLowerCase()

				// ?/H shows help overlay
				if (key.sequence === '?' || name === 'h') {
					this.helpOverlay.toggle()
					return
				}

				// Enter: enter input mode
				if (name === 'return') {
					this.enterInputMode()
					return
				}

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
					this.logWriter.markCopyStart(this.activePane)
					return
				}

				if (name === SHORTCUTS.timestamps.key) {
					// Toggle timestamps on all panes (use config format or default)
					const firstPane = this.panes.values().next().value
					if (firstPane?.timestampsEnabled) {
						for (const pane of this.panes.values()) pane.setTimestamps(false)
					} else {
						const fmt: boolean | string = this.config.timestamps ?? true
						for (const pane of this.panes.values()) pane.setTimestamps(fmt)
					}
					return
				}

				if (name === SHORTCUTS.openLogs.key) {
					this.openLogDirectory()
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

				// Up/Down: scroll by line, Shift+Up/Down: scroll to top/bottom
				if (name === 'up' || name === 'down') {
					const pane = this.panes.get(this.activePane)
					if (key.shift) {
						name === 'up' ? pane?.scrollToTop() : pane?.scrollToBottom()
					} else {
						pane?.scrollBy(name === 'up' ? -1 : 1)
					}
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

		// Show first pane. Tab bar is not focused — keyboard navigation (1-9, Left/Right)
		// is handled by the global keypress handler so Up/Down can scroll the active pane.
		if (this.names.length > 0) {
			this.switchPane(this.names[0])
		}

		// Start all processes
		await this.manager.startAll(termCols, termRows)
	}

	private enterInputMode(): void {
		this.inputMode = true
		this.statusBar.setInputMode(true)
		// Show cursor in active pane while in input mode
		if (this.activePane) {
			const pane = this.panes.get(this.activePane)
			if (pane) pane.terminal.showCursor = true
		}
	}

	private exitInputMode(): void {
		this.inputMode = false
		this.statusBar.setInputMode(false)
		// Hide cursor again unless process is natively interactive
		if (this.activePane) {
			const isInteractive = this.config.processes[this.activePane]?.interactive === true
			if (!isInteractive) {
				const pane = this.panes.get(this.activePane)
				if (pane) pane.terminal.showCursor = false
			}
		}
	}

	/**
	 * Force OpenTUI to repaint every cell on every frame instead of diffing.
	 *
	 * OpenTUI emits only changed cells via absolute cursor moves. When the host
	 * terminal's cursor tracking drifts from OpenTUI's model — ambiguous-width
	 * glyphs, autowrap at the screen edge, or a sequence the emulator mishandles —
	 * the diff path never self-corrects: pane output smears into the tab sidebar
	 * and the scrollbar drops out. A full repaint (the path resize already used)
	 * re-emits the whole buffer, so the corruption can't accumulate.
	 *
	 * The renderer clears `forceFullRepaintRequested` after each native render, so
	 * we re-raise it in a frame callback — which runs before the render reads it,
	 * and only fires on demand-driven frames (no idle cost). Composition stays
	 * dirty-tracked, so the only overhead is more stdout bytes during active
	 * output (bounded by targetFps).
	 *
	 * Done in app code rather than a `bun patch`, because `patchedDependencies`
	 * does not propagate to projects that install numux as a dependency — only a
	 * fix shipped in numux's own bundle reaches consumers.
	 */
	private forceFullRepaints(renderer: CliRenderer): void {
		const r = renderer as unknown as { forceFullRepaintRequested?: boolean }
		if (!('forceFullRepaintRequested' in r)) {
			log('warning: @opentui/core has no forceFullRepaintRequested flag — render-drift workaround inactive')
			return
		}
		renderer.setFrameCallback(async () => {
			r.forceFullRepaintRequested = true
		})
	}

	private switchPane(name: string): void {
		if (this.activePane === name) return
		// Exit input mode on pane switch
		if (this.inputMode) {
			this.exitInputMode()
		}
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

	/** Open the log directory in the system file manager. */
	private openLogDirectory(): void {
		const dir = this.logWriter.getDirectory()
		const cmd = process.platform === 'darwin' ? 'open' : 'xdg-open'
		try {
			Bun.spawn([cmd, dir], { stdout: 'ignore', stderr: 'ignore' })
			this.statusBar.showTemporaryMessage(`Opening ${dir}`)
		} catch {
			this.statusBar.showTemporaryMessage('Could not open log directory')
		}
	}

	/** Copy all text in the active pane to clipboard (unwrapped, from log file). */
	private copyAllText(): void {
		if (!this.activePane) return

		const text = this.logWriter.readLog(this.activePane)
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
