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

const STATUS_ANSI: Partial<Record<ProcessStatus, string>> = {
	ready: '\x1b[32m',
	failed: '\x1b[31m',
	stopped: '\x1b[90m',
	skipped: '\x1b[90m'
}

const RESET = '\x1b[0m'

export class TabBar {
	readonly renderable: TabSelectRenderable
	private names: string[]
	private statuses: Map<string, ProcessStatus>
	private colors: Map<string, string>

	constructor(renderer: CliRenderer, names: string[], colors?: Map<string, string>) {
		this.names = names
		this.statuses = new Map(names.map(n => [n, 'pending' as ProcessStatus]))
		this.colors = colors ?? new Map()

		this.renderable = new TabSelectRenderable(renderer, {
			id: 'tab-bar',
			width: '100%',
			options: names.map(n => ({
				name: this.formatTab(n, 'pending'),
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

	updateStatus(name: string, status: ProcessStatus, exitCode?: number | null, restartCount?: number): void {
		this.statuses.set(name, status)
		const options = this.names.map(n => {
			const s = this.statuses.get(n)!
			const desc: string = n === name ? this.formatDescription(status, exitCode, restartCount) : s
			return { name: this.formatTab(n, s), description: desc }
		})
		this.renderable.setOptions(options)
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
		const ansi = STATUS_ANSI[status]
		if (ansi) {
			return `${ansi}${icon}${RESET} ${name}`
		}
		const color = this.colors.get(name)
		if (color) {
			return `${color}${icon}${RESET} ${name}`
		}
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
