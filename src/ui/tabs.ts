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

export const STATUS_ICONS: Record<ProcessStatus, string> = {
	pending: '○',
	starting: '◐',
	running: '◉',
	ready: '●',
	stopping: '◑',
	stopped: '■',
	finished: '✓',
	failed: '✖',
	skipped: '⊘'
}

/** Status-specific icon colors (override process colors) */
export const STATUS_ICON_HEX: Partial<Record<ProcessStatus, string>> = {
	ready: '#00cc00',
	finished: '#66aa66',
	failed: '#ff5555',
	stopped: '#888888',
	skipped: '#888888'
}

/** Statuses that represent a terminal (done) state — tabs move to bottom */
export const TERMINAL_STATUSES = new Set<ProcessStatus>(['finished', 'stopped', 'failed', 'skipped'])

export function formatTab(name: string, status: ProcessStatus): string {
	return `${STATUS_ICONS[status]} ${name}`
}

export function formatDescription(status: ProcessStatus, exitCode?: number | null, restartCount?: number): string {
	let desc: string = status
	if ((status === 'failed' || status === 'stopped') && exitCode != null && exitCode !== 0) {
		desc = `exit ${exitCode}`
	}
	if (restartCount && restartCount > 0) {
		desc += ` ×${restartCount}`
	}
	return desc
}

export function getDisplayOrder(originalNames: string[], statuses: Map<string, ProcessStatus>): string[] {
	const active = originalNames.filter(n => !TERMINAL_STATUSES.has(statuses.get(n)!))
	const terminal = originalNames.filter(n => TERMINAL_STATUSES.has(statuses.get(n)!))
	return [...active, ...terminal]
}

export function resolveOptionColors(
	names: string[],
	statuses: Map<string, ProcessStatus>,
	processColors: Map<string, string>,
	inputWaiting: Set<string>,
	erroredProcesses: Set<string>
): Array<{ iconHex: string; nameHex: string | null }> {
	return names.map(name => {
		const status = statuses.get(name)!
		const waiting = inputWaiting.has(name)
		const errored = erroredProcesses.has(name)
		const statusHex = waiting ? '#ffaa00' : errored ? '#ff5555' : STATUS_ICON_HEX[status]
		const processHex = processColors.get(name)
		return {
			iconHex: statusHex ?? processHex ?? '#888888',
			nameHex: processHex ?? null
		}
	})
}

interface OptionColors {
	icon: RGBA | null
	name: RGBA | null
}

/**
 * SelectRenderable subclass that renders options with per-option icon/name colors.
 *
 * Overrides refreshFrameBuffer to do a single-pass render instead of the base class's
 * render-then-overdraw approach. This avoids ghost characters that appear when the
 * base class's "▶ " prefix and the override's text disagree on character widths.
 */
class ColoredSelectRenderable extends SelectRenderable {
	private _optionColors: OptionColors[] = []

	setOptionColors(colors: OptionColors[]): void {
		this._optionColors = colors
		this.requestRender()
	}

	protected renderSelf(_buffer: OptimizedBuffer, _deltaTime: number): void {
		if (!(this.visible && this.frameBuffer)) return
		if (this.isDirty) this.renderOptions()
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

	/** Single-pass render that draws options with correct colors from the start. */
	private renderOptions(): void {
		if (!this.frameBuffer || this.options.length === 0) return

		const fb = this.frameBuffer
		const bgColor = (this as any)._focused ? (this as any)._focusedBackgroundColor : (this as any)._backgroundColor
		fb.clear(bgColor)

		const scrollOffset = (this as any).scrollOffset as number
		const maxVisibleItems = (this as any).maxVisibleItems as number
		const linesPerItem = (this as any).linesPerItem as number
		const fontHeight = (this as any).fontHeight as number
		const selectedIndex = this.getSelectedIndex()
		const showDescription = (this as any)._showDescription as boolean
		const baseTextColor: RGBA = (this as any)._focused ? (this as any)._focusedTextColor : (this as any)._textColor
		const selectedTextColor: RGBA = (this as any)._selectedTextColor
		const descColor: RGBA = (this as any)._descriptionColor
		const selectedDescColor: RGBA = (this as any)._selectedDescriptionColor
		const selectedBgColor: RGBA = (this as any)._selectedBackgroundColor
		const itemSpacing = (this as any)._itemSpacing as number

		const visibleCount = Math.min(maxVisibleItems, this.options.length - scrollOffset)

		for (let i = 0; i < visibleCount; i++) {
			const actualIndex = scrollOffset + i
			const option = this.options[actualIndex]
			const isSelected = actualIndex === selectedIndex
			const itemY = i * linesPerItem

			if (itemY + linesPerItem - 1 >= this.height) break

			// Selection highlight background
			if (isSelected) {
				fb.fillRect(0, itemY, this.width, linesPerItem - itemSpacing, selectedBgColor)
			}

			// Draw option name with per-option colors (no ▶ prefix — background shows selection)
			const colors = this._optionColors[actualIndex]
			const defaultColor = isSelected ? selectedTextColor : baseTextColor
			const nameColor = colors?.name ?? defaultColor
			fb.drawText(option.name, 1, itemY, nameColor)

			// Overdraw the icon character with its status-specific color
			if (colors?.icon) {
				fb.drawText(option.name.charAt(0), 1, itemY, colors.icon)
			}

			// Description
			if (showDescription && itemY + fontHeight < this.height) {
				const dc = isSelected ? selectedDescColor : descColor
				fb.drawText(option.description, 3, itemY + fontHeight, dc)
			}
		}
	}
}

export class TabBar {
	readonly renderable: ColoredSelectRenderable
	private originalNames: string[]
	private names: string[]
	private statuses: Map<string, ProcessStatus>
	private baseDescriptions: Map<string, string>
	private processColors: Map<string, string>
	private inputWaiting = new Set<string>()
	private erroredProcesses = new Set<string>()

	constructor(renderer: CliRenderer, names: string[], colors?: Map<string, string>) {
		this.originalNames = names
		this.names = [...names]
		this.statuses = new Map(names.map(n => [n, 'pending' as ProcessStatus]))
		this.baseDescriptions = new Map(names.map(n => [n, 'pending']))
		this.processColors = colors ?? new Map()

		this.renderable = new ColoredSelectRenderable(renderer, {
			id: 'tab-bar',
			width: '100%',
			height: '100%',
			options: names.map(n => ({
				name: formatTab(n, 'pending'),
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
		this.baseDescriptions.set(name, formatDescription(status, exitCode, restartCount))
		// Clear input waiting on terminal status changes
		if (TERMINAL_STATUSES.has(status) || status === 'stopping') {
			this.inputWaiting.delete(name)
		}
		// Clear error indicator when process restarts
		if (status === 'starting') {
			this.erroredProcesses.delete(name)
		}
		this.refreshOptions()
	}

	setInputWaiting(name: string, waiting: boolean): void {
		if (waiting) this.inputWaiting.add(name)
		else this.inputWaiting.delete(name)
		this.refreshOptions()
	}

	setError(name: string, hasError: boolean): void {
		if (hasError) this.erroredProcesses.add(name)
		else this.erroredProcesses.delete(name)
		this.refreshOptions()
	}

	/** Get the process name at the given display index */
	getNameAtIndex(index: number): string {
		return this.names[index]
	}

	get count(): number {
		return this.names.length
	}

	private refreshOptions(): void {
		// Preserve currently selected name
		const currentIdx = this.renderable.getSelectedIndex()
		const currentName = this.names[currentIdx]

		// Reorder: active first, terminal states at bottom
		this.names = getDisplayOrder(this.originalNames, this.statuses)

		this.renderable.options = this.names.map(n => ({
			name: formatTab(n, this.statuses.get(n)!),
			description: this.getDescription(n)
		}))

		// Restore selection by name
		const newIdx = this.names.indexOf(currentName)
		if (newIdx >= 0 && newIdx !== currentIdx) {
			this.renderable.setSelectedIndex(newIdx)
		}

		this.updateOptionColors()
	}

	private getDescription(name: string): string {
		if (this.inputWaiting.has(name)) return 'awaiting input'
		if (this.erroredProcesses.has(name)) return 'error detected'
		return this.baseDescriptions.get(name) ?? 'pending'
	}

	private updateOptionColors(): void {
		const resolved = resolveOptionColors(
			this.names,
			this.statuses,
			this.processColors,
			this.inputWaiting,
			this.erroredProcesses
		)
		const colors = resolved.map(c => ({
			icon: parseColor(c.iconHex),
			name: c.nameHex ? parseColor(c.nameHex) : null
		}))
		this.renderable.setOptionColors(colors)
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
