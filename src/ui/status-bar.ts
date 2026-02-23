import { type CliRenderer, TextRenderable } from '@opentui/core'
import type { ProcessStatus } from '../types'

export class StatusBar {
	readonly renderable: TextRenderable
	private statuses = new Map<string, ProcessStatus>()

	constructor(renderer: CliRenderer, names: string[]) {
		for (const name of names) {
			this.statuses.set(name, 'pending')
		}

		this.renderable = new TextRenderable(renderer, {
			id: 'status-bar',
			width: '100%',
			height: 1,
			content: this.buildContent(),
			bg: '#1a1a1a',
			paddingX: 1
		})
	}

	updateStatus(name: string, status: ProcessStatus): void {
		this.statuses.set(name, status)
		this.renderable.content = this.buildContent()
	}

	private buildContent(): string {
		const parts: string[] = []
		for (const [name, status] of this.statuses) {
			parts.push(`${name}:${status}`)
		}
		return `${parts.join('  ')}  Alt+←→/1-9: tabs  Alt+R: restart  Ctrl+C: quit`
	}
}
