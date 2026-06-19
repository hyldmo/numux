import type { RenderContext } from '@opentui/core'
import { type GhosttyTerminalOptions, GhosttyTerminalRenderable } from 'ghostty-opentui/terminal-buffer'

/**
 * GhosttyTerminalRenderable that renders the tail of scrollback when `limit` is set.
 *
 * Upstream passes only `{ limit }` to getJson, which returns the first N lines
 * (oldest). For a streaming log pane we want the last N (newest). This subclass
 * patches the underlying persistent terminal so every render queries
 * `offset = max(0, totalLines - limit)`, giving tail semantics without touching
 * the parent render path.
 *
 * Without `limit`, behaviour is unchanged.
 *
 * Two getJson calls per render: a peek with `limit: 1` to read totalLines,
 * then the real query with the computed offset. Both are cheap — the zig-side
 * per-line cost is paid only for lines actually emitted.
 *
 * Upstream issue: https://github.com/remorses/ghostty-opentui/issues/7
 */
export class TailingTerminal extends GhosttyTerminalRenderable {
	constructor(ctx: RenderContext, options: GhosttyTerminalOptions) {
		super(ctx, options)

		type GetJsonOpts = { offset?: number; limit?: number }
		type GetJsonResult = { totalLines: number }
		type PersistentTerminalLike = {
			getJson: (opts?: GetJsonOpts) => GetJsonResult
		}
		const self = this as unknown as { _persistentTerminal: PersistentTerminalLike | null }
		const pt = self._persistentTerminal
		if (!pt) return

		const origGetJson = pt.getJson.bind(pt)
		pt.getJson = (opts: GetJsonOpts = {}): GetJsonResult => {
			if (opts.limit && opts.offset === undefined) {
				const peek = origGetJson({ limit: 1 })
				const offset = Math.max(0, peek.totalLines - opts.limit)
				return origGetJson({ offset, limit: opts.limit })
			}
			return origGetJson(opts)
		}
	}
}
