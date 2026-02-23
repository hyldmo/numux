import { type CliRenderer, TabSelectRenderable, TabSelectRenderableEvents } from '@opentui/core'
import type { ProcessStatus } from '../types'

const STATUS_ICONS: Record<ProcessStatus, string> = {
	pending: '○',
	starting: '◐',
	running: '◉',
	ready: '●',
	stopping: '◑',
	stopped: '■',
	failed: '✖',
	skipped: '⊘'
}

export class TabBar {
	readonly renderable: TabSelectRenderable
	private names: string[]
	private statuses: Map<string, ProcessStatus>

	constructor(renderer: CliRenderer, names: string[]) {
		this.names = names
		this.statuses = new Map(names.map(n => [n, 'pending' as ProcessStatus]))

		this.renderable = new TabSelectRenderable(renderer, {
			id: 'tab-bar',
			width: '100%',
			options: names.map(n => ({
				name: `${STATUS_ICONS.pending} ${n}`,
				description: 'pending'
			})),
			tabWidth: 20,
			selectedBackgroundColor: '#334455',
			selectedTextColor: '#fff',
			textColor: '#888',
			showDescription: true,
			showUnderline: true,
			wrapSelection: true
		})
	}

	onSelect(handler: (index: number, name: string) => void): void {
		this.renderable.on(TabSelectRenderableEvents.ITEM_SELECTED, (index: number) => {
			handler(index, this.names[index])
		})
	}

	onSelectionChanged(handler: (index: number, name: string) => void): void {
		this.renderable.on(TabSelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
			handler(index, this.names[index])
		})
	}

	updateStatus(name: string, status: ProcessStatus): void {
		this.statuses.set(name, status)
		const options = this.names.map(n => {
			const s = this.statuses.get(n)!
			const icon = STATUS_ICONS[s]
			return { name: `${icon} ${n}`, description: s }
		})
		this.renderable.setOptions(options)
	}

	getSelectedIndex(): number {
		return this.renderable.getSelectedIndex()
	}

	setSelectedIndex(index: number): void {
		this.renderable.setSelectedIndex(index)
	}

	focus(): void {
		this.renderable.focus()
	}
}
