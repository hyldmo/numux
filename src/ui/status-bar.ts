import { type CliRenderer, TextRenderable } from '@opentui/core'
import type { ProcessStatus } from '../types'

const STATUS_ANSI: Partial<Record<ProcessStatus, string>> = {
	ready: '\x1b[32m',
	running: '\x1b[36m',
	failed: '\x1b[31m',
	stopped: '\x1b[90m',
	skipped: '\x1b[90m'
}

const RESET = '\x1b[0m'

export class StatusBar {
	readonly renderable: TextRenderable
	private statuses = new Map<string, ProcessStatus>()
	private colors: Map<string, string>
	private scrolledUp = false

	constructor(renderer: CliRenderer, names: string[], colors?: Map<string, string>) {
		this.colors = colors ?? new Map()
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

	setScrollIndicator(scrolledUp: boolean): void {
		if (this.scrolledUp === scrolledUp) return
		this.scrolledUp = scrolledUp
		this.renderable.content = this.buildContent()
	}

	private buildContent(): string {
		const parts: string[] = []
		for (const [name, status] of this.statuses) {
			const ansi = STATUS_ANSI[status] ?? this.colors.get(name)
			if (ansi) {
				parts.push(`${ansi}${name}:${status}${RESET}`)
			} else {
				parts.push(`${name}:${status}`)
			}
		}
		const scroll = this.scrolledUp ? `  \x1b[33m[scrolled]\x1b[0m` : ''
		return `${parts.join('  ')}${scroll}  Alt+←→/1-9: tabs  Alt+PgUp/Dn: scroll  Alt+R: restart  Alt+L: clear  Ctrl+C: quit`
	}
}
