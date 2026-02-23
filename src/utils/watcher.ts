import { type FSWatcher, watch } from 'node:fs'
import { log } from './logger'

const DEBOUNCE_MS = 300
const IGNORED_SEGMENTS = new Set(['node_modules', '.git'])

export class FileWatcher {
	private watchers: FSWatcher[] = []
	private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

	watch(name: string, patterns: string[], cwd: string, onChanged: (path: string) => void): void {
		const globs = patterns.map(p => new Bun.Glob(p))

		try {
			const watcher = watch(cwd, { recursive: true }, (_event, filename) => {
				if (!filename) return

				// Skip node_modules, .git, etc.
				const segments = filename.split('/')
				if (segments.some(s => IGNORED_SEGMENTS.has(s))) return

				// Check if changed file matches any pattern
				if (!globs.some(g => g.match(filename))) return

				// Debounce per process
				const existing = this.debounceTimers.get(name)
				if (existing) clearTimeout(existing)
				this.debounceTimers.set(
					name,
					setTimeout(() => {
						this.debounceTimers.delete(name)
						onChanged(filename)
					}, DEBOUNCE_MS)
				)
			})
			this.watchers.push(watcher)
			log(`[${name}] Watching: ${patterns.join(', ')}`)
		} catch (err) {
			log(`[${name}] Failed to set up file watcher: ${err}`)
		}
	}

	close(): void {
		for (const timer of this.debounceTimers.values()) {
			clearTimeout(timer)
		}
		this.debounceTimers.clear()
		for (const watcher of this.watchers) {
			watcher.close()
		}
		this.watchers = []
	}
}
