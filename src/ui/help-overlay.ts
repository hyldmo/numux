import { BoxRenderable, type CliRenderer, TextRenderable } from '@opentui/core'
import { DARK_THEME, type Theme } from '../utils/theme'
import { STATUS_HINTS_FULL, toHintPair } from './keybindings'

export class HelpOverlay {
	readonly renderable: BoxRenderable
	private textRenderable: TextRenderable

	constructor(renderer: CliRenderer, theme: Theme = DARK_THEME) {
		this.renderable = new BoxRenderable(renderer, {
			id: 'help-overlay',
			position: 'absolute',
			width: '100%',
			height: '100%',
			zIndex: 100,
			visible: false,
			justifyContent: 'center',
			alignItems: 'center'
		})

		// Semi-transparent backdrop
		const backdrop = new BoxRenderable(renderer, {
			id: 'help-backdrop',
			position: 'absolute',
			width: '100%',
			height: '100%',
			backgroundColor: theme.helpBackdropBg,
			opacity: 0.7
		})

		// Content box
		const box = new BoxRenderable(renderer, {
			id: 'help-box',
			flexDirection: 'column',
			padding: 1,
			paddingX: 5,
			backgroundColor: theme.helpBoxBg,
			border: true,
			borderColor: theme.helpBorder,
			zIndex: 101
		})

		const lines: string[] = [
			'Keyboard Shortcuts',
			'',
			...STATUS_HINTS_FULL.map(h => {
				const [label, desc] = toHintPair(h)
				return `  ${label.padEnd(14)} ${desc}`
			}),
			'',
			'Press H or Esc to close'
		]

		this.textRenderable = new TextRenderable(renderer, {
			id: 'help-text',
			content: lines.join('\n'),
			fg: theme.helpText
		})

		box.add(this.textRenderable)
		this.renderable.add(backdrop)
		this.renderable.add(box)
	}

	get isVisible(): boolean {
		return this.renderable.visible
	}

	toggle(): void {
		this.renderable.visible = !this.renderable.visible
	}

	hide(): void {
		this.renderable.visible = false
	}

	show(): void {
		this.renderable.visible = true
	}
}
