import { type CliRenderer, SelectRenderable, SelectRenderableEvents } from '@opentui/core'
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
	readonly renderable: SelectRenderable
	private names: string[]
	private statuses: Map<string, ProcessStatus>
	private descriptions: Map<string, string>

	constructor(renderer: CliRenderer, names: string[]) {
		this.names = names
		this.statuses = new Map(names.map(n => [n, 'pending' as ProcessStatus]))
		this.descriptions = new Map(names.map(n => [n, 'pending']))

		this.renderable = new SelectRenderable(renderer, {
			id: 'tab-bar',
			width: '100%',
			height: '100%',
			options: names.map(n => ({
				name: this.formatTab(n, 'pending'),
				description: 'pending'
			})),
			selectedBackgroundColor: '#334455',
			selectedTextColor: '#fff',
			textColor: '#888',
			showDescription: true,
			wrapSelection: true
		})
	}

	onSelect(handler: (index: number, name: string) => void): void {
		this.renderable.on(SelectRenderableEvents.ITEM_SELECTED, (index: number) => {
			handler(index, this.names[index])
		})
	}

	onSelectionChanged(handler: (index: number, name: string) => void): void {
		this.renderable.on(SelectRenderableEvents.SELECTION_CHANGED, (index: number) => {
			handler(index, this.names[index])
		})
	}

	updateStatus(name: string, status: ProcessStatus, exitCode?: number | null, restartCount?: number): void {
		this.statuses.set(name, status)
		this.descriptions.set(name, this.formatDescription(status, exitCode, restartCount))
		this.renderable.options = this.names.map(n => ({
			name: this.formatTab(n, this.statuses.get(n)!),
			description: this.descriptions.get(n)!
		}))
	}

	private formatDescription(status: ProcessStatus, exitCode?: number | null, restartCount?: number): string {
		let desc: string = status
		if ((status === 'failed' || status === 'stopped') && exitCode != null && exitCode !== 0) {
			desc = `exit ${exitCode}`
		}
		if (restartCount && restartCount > 0) {
			desc += ` ×${restartCount}`
		}
		return desc
	}

	private formatTab(name: string, status: ProcessStatus): string {
		const icon = STATUS_ICONS[status]
		return `${icon} ${name}`
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
