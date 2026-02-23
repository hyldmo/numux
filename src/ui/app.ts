import { BoxRenderable, type CliRenderer, createCliRenderer } from '@opentui/core'
import type { ProcessManager } from '../process/manager'
import { Pane } from './pane'
import { StatusBar } from './status-bar'
import { TabBar } from './tabs'

export class App {
	private renderer!: CliRenderer
	private manager: ProcessManager
	private panes = new Map<string, Pane>()
	private tabBar!: TabBar
	private statusBar!: StatusBar
	private activePane: string | null = null
	private destroyed = false
	private names: string[]

	constructor(manager: ProcessManager) {
		this.manager = manager
		this.names = manager.getProcessNames()
	}

	async start(): Promise<void> {
		this.renderer = await createCliRenderer({
			exitOnCtrlC: false,
			useMouse: true
		})

		const { width, height } = this.renderer
		const termCols = Math.max(40, width - 2)
		const termRows = Math.max(5, height - 5)

		// Layout root
		const layout = new BoxRenderable(this.renderer, {
			id: 'root',
			flexDirection: 'column',
			width: '100%',
			height: '100%',
			border: false
		})

		// Tab bar
		this.tabBar = new TabBar(this.renderer, this.names)

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
			this.panes.set(name, pane)
			paneContainer.add(pane.scrollBox)
		}

		// Status bar
		this.statusBar = new StatusBar(this.renderer, this.names)

		// Assemble layout
		layout.add(this.tabBar.renderable)
		layout.add(paneContainer)
		layout.add(this.statusBar.renderable)
		this.renderer.root.add(layout)

		// Wire tab events
		this.tabBar.onSelect((_index, name) => this.switchPane(name))
		this.tabBar.onSelectionChanged((_index, name) => this.switchPane(name))
		this.tabBar.focus()

		// Wire process events
		this.manager.on(event => {
			if (this.destroyed) return
			if (event.type === 'output') {
				this.panes.get(event.name)?.feed(event.data)
			} else if (event.type === 'status') {
				this.tabBar.updateStatus(event.name, event.status)
				this.statusBar.updateStatus(event.name, event.status)
			}
		})

		// Handle resize
		this.renderer.on('resize', (w: number, h: number) => {
			const cols = Math.max(40, w - 2)
			const rows = Math.max(5, h - 5)
			for (const pane of this.panes.values()) {
				pane.resize(cols, rows)
			}
			this.manager.resizeAll(cols, rows)
		})

		// Global keyboard handler
		this.renderer.keyInput.on(
			'keypress',
			(key: { ctrl: boolean; shift: boolean; meta: boolean; name: string; sequence: string }) => {
				// Ctrl+C: quit
				if (key.ctrl && key.name === 'c') {
					this.shutdown()
					return
				}

				// Alt+1-9: jump to tab
				if (key.meta && !key.ctrl && !key.shift) {
					const num = Number.parseInt(key.name, 10)
					if (num >= 1 && num <= 9 && num <= this.names.length) {
						this.tabBar.setSelectedIndex(num - 1)
						this.switchPane(this.names[num - 1])
						return
					}
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
		if (this.activePane) {
			this.panes.get(this.activePane)?.hide()
		}
		this.activePane = name
		this.panes.get(name)?.show()
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
