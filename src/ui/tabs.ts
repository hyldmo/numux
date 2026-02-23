import {
	type CliRenderer,
	type MouseEvent,
	type OptimizedBuffer,
	parseColor,
	type RGBA,
	SelectRenderable,
	SelectRenderableEvents
} from '@opentui/core'
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

/** Status-specific icon colors (override process colors) */
const STATUS_ICON_HEX: Partial<Record<ProcessStatus, string>> = {
	ready: '#00cc00',
	failed: '#ff5555',
	stopped: '#888888',
	skipped: '#888888'
}

interface OptionColors {
	icon: RGBA | null
	name: RGBA | null
}

/**
 * SelectRenderable subclass that supports per-option coloring.
 * The base SelectRenderable draws all option text with a single color.
 * This overrides renderSelf to repaint the icon and name with individual
 * RGBA colors after the base render.
 */
class ColoredSelectRenderable extends SelectRenderable {
	private _optionColors: OptionColors[] = []

	setOptionColors(colors: OptionColors[]): void {
		this._optionColors = colors
		this.requestRender()
	}

	protected renderSelf(buffer: OptimizedBuffer, deltaTime: number): void {
		const wasDirty = this.isDirty
		super.renderSelf(buffer, deltaTime)
		if (wasDirty && this.frameBuffer && this._optionColors.length > 0) {
			this.colorizeOptions()
		}
	}

	protected onMouseEvent(event: MouseEvent): void {
		if (event.type === 'down') {
			const linesPerItem = (this as any).linesPerItem as number
			const scrollOffset = (this as any).scrollOffset as number
			const clickedIndex = scrollOffset + Math.floor(event.y / linesPerItem)
			if (clickedIndex >= 0 && clickedIndex < this.options.length) {
				this.setSelectedIndex(clickedIndex)
				this.selectCurrent()
			}
		}
	}

	private colorizeOptions(): void {
		const fb = this.frameBuffer!
		// Access internal layout state (private in TS, accessible at runtime)
		const scrollOffset = (this as any).scrollOffset as number
		const maxVisibleItems = (this as any).maxVisibleItems as number
		const linesPerItem = (this as any).linesPerItem as number
		const options = this.options
		const visibleCount = Math.min(maxVisibleItems, options.length - scrollOffset)

		for (let i = 0; i < visibleCount; i++) {
			const actualIndex = scrollOffset + i
			const colors = this._optionColors[actualIndex]
			if (!colors) continue
			const itemY = i * linesPerItem
			// Layout: "▶ ○ name" or "  ○ name" (drawText at x=1, prefix 2 chars)
			// Icon at x=3, space at x=4, name starts at x=5
			const optName = options[actualIndex].name
			if (colors.icon) {
				fb.drawText(optName.charAt(0), 3, itemY, colors.icon)
			}
			if (colors.name) {
				fb.drawText(optName.slice(2), 5, itemY, colors.name)
			}
		}
	}
}

export class TabBar {
	readonly renderable: ColoredSelectRenderable
	private names: string[]
	private statuses: Map<string, ProcessStatus>
	private descriptions: Map<string, string>
	private processColors: Map<string, string>

	constructor(renderer: CliRenderer, names: string[], colors?: Map<string, string>) {
		this.names = names
		this.statuses = new Map(names.map(n => [n, 'pending' as ProcessStatus]))
		this.descriptions = new Map(names.map(n => [n, 'pending']))
		this.processColors = colors ?? new Map()

		this.renderable = new ColoredSelectRenderable(renderer, {
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
		this.updateOptionColors()
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
		this.updateOptionColors()
	}

	private updateOptionColors(): void {
		const colors = this.names.map(name => {
			const status = this.statuses.get(name)!
			const statusHex = STATUS_ICON_HEX[status]
			const processHex = this.processColors.get(name)
			return {
				icon: parseColor(statusHex ?? processHex ?? '#888888'),
				name: processHex ? parseColor(processHex) : null
			}
		})
		this.renderable.setOptionColors(colors)
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
