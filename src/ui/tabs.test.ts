import { describe, expect, test } from 'bun:test'
import type { ProcessStatus } from '../types'
import {
	formatDescription,
	formatTab,
	getDisplayOrder,
	resolveOptionColors,
	STATUS_ICON_HEX,
	STATUS_ICONS,
	TERMINAL_STATUSES
} from './tabs'

describe('formatTab', () => {
	test('includes status icon and name', () => {
		expect(formatTab('web', 'ready')).toBe('● web')
		expect(formatTab('api', 'pending')).toBe('○ api')
		expect(formatTab('db', 'failed')).toBe('✖ db')
	})

	test('uses correct icon for each status', () => {
		const statuses: ProcessStatus[] = [
			'pending',
			'starting',
			'running',
			'ready',
			'stopping',
			'stopped',
			'finished',
			'failed',
			'skipped'
		]
		for (const status of statuses) {
			const result = formatTab('x', status)
			expect(result).toBe(`${STATUS_ICONS[status]} x`)
		}
	})

	test('all icons are single codepoint', () => {
		for (const icon of Object.values(STATUS_ICONS)) {
			expect(icon.length).toBe(1)
		}
	})
})

describe('formatDescription', () => {
	test('returns status as-is by default', () => {
		expect(formatDescription('running')).toBe('running')
		expect(formatDescription('ready')).toBe('ready')
		expect(formatDescription('pending')).toBe('pending')
	})

	test('shows exit code for failed status', () => {
		expect(formatDescription('failed', 1)).toBe('exit 1')
		expect(formatDescription('failed', 127)).toBe('exit 127')
	})

	test('shows exit code for stopped status', () => {
		expect(formatDescription('stopped', 143)).toBe('exit 143')
	})

	test('does not show exit code 0', () => {
		expect(formatDescription('failed', 0)).toBe('failed')
		expect(formatDescription('stopped', 0)).toBe('stopped')
	})

	test('does not show exit code for non-failed/stopped statuses', () => {
		expect(formatDescription('running', 1)).toBe('running')
		expect(formatDescription('ready', 1)).toBe('ready')
	})

	test('appends restart count', () => {
		expect(formatDescription('running', null, 3)).toBe('running ×3')
		expect(formatDescription('failed', 1, 2)).toBe('exit 1 ×2')
	})

	test('does not append restart count of 0', () => {
		expect(formatDescription('running', null, 0)).toBe('running')
	})
})

describe('getDisplayOrder', () => {
	test('keeps all active processes in original order', () => {
		const names = ['web', 'api', 'db']
		const statuses = new Map<string, ProcessStatus>([
			['web', 'running'],
			['api', 'ready'],
			['db', 'starting']
		])
		expect(getDisplayOrder(names, statuses)).toEqual(['web', 'api', 'db'])
	})

	test('moves terminal-state processes to end', () => {
		const names = ['web', 'api', 'db']
		const statuses = new Map<string, ProcessStatus>([
			['web', 'ready'],
			['api', 'stopped'],
			['db', 'running']
		])
		expect(getDisplayOrder(names, statuses)).toEqual(['web', 'db', 'api'])
	})

	test('preserves relative order within active and terminal groups', () => {
		const names = ['a', 'b', 'c', 'd', 'e']
		const statuses = new Map<string, ProcessStatus>([
			['a', 'ready'],
			['b', 'failed'],
			['c', 'running'],
			['d', 'finished'],
			['e', 'stopped']
		])
		expect(getDisplayOrder(names, statuses)).toEqual(['a', 'c', 'b', 'd', 'e'])
	})

	test('all terminal statuses move to end', () => {
		for (const status of TERMINAL_STATUSES) {
			const statuses = new Map<string, ProcessStatus>([
				['first', status],
				['second', 'running']
			])
			expect(getDisplayOrder(['first', 'second'], statuses)).toEqual(['second', 'first'])
		}
	})

	test('non-terminal statuses stay in place', () => {
		const nonTerminal: ProcessStatus[] = ['pending', 'starting', 'running', 'ready', 'stopping']
		for (const status of nonTerminal) {
			const statuses = new Map<string, ProcessStatus>([
				['first', status],
				['second', 'running']
			])
			expect(getDisplayOrder(['first', 'second'], statuses)).toEqual(['first', 'second'])
		}
	})
})

describe('resolveOptionColors', () => {
	function resolve(
		names: string[],
		statuses: Record<string, ProcessStatus>,
		opts?: { processColors?: Record<string, string>; inputWaiting?: string[]; errored?: string[] }
	) {
		return resolveOptionColors(
			names,
			new Map(Object.entries(statuses)),
			new Map(Object.entries(opts?.processColors ?? {})),
			new Set(opts?.inputWaiting ?? []),
			new Set(opts?.errored ?? [])
		)
	}

	test('uses status-specific icon color when available', () => {
		const result = resolve(['web'], { web: 'ready' })
		expect(result[0].iconHex).toBe('#00cc00')
	})

	test('falls back to process color when no status color', () => {
		const result = resolve(['web'], { web: 'running' }, { processColors: { web: '#ff0000' } })
		// running has no STATUS_ICON_HEX entry
		expect(STATUS_ICON_HEX.running).toBeUndefined()
		expect(result[0].iconHex).toBe('#ff0000')
	})

	test('falls back to default gray when no status or process color', () => {
		const result = resolve(['web'], { web: 'running' })
		expect(result[0].iconHex).toBe('#888888')
	})

	test('input waiting overrides icon color to orange', () => {
		const result = resolve(['web'], { web: 'ready' }, { inputWaiting: ['web'] })
		expect(result[0].iconHex).toBe('#ffaa00')
	})

	test('error overrides icon color to red', () => {
		const result = resolve(['web'], { web: 'ready' }, { errored: ['web'] })
		expect(result[0].iconHex).toBe('#ff5555')
	})

	test('input waiting takes priority over error', () => {
		const result = resolve(['web'], { web: 'ready' }, { inputWaiting: ['web'], errored: ['web'] })
		expect(result[0].iconHex).toBe('#ffaa00')
	})

	test('name color is set from process color', () => {
		const result = resolve(['web'], { web: 'running' }, { processColors: { web: '#ff0000' } })
		expect(result[0].nameHex).toBe('#ff0000')
	})

	test('name color is null when no process color', () => {
		const result = resolve(['web'], { web: 'running' })
		expect(result[0].nameHex).toBeNull()
	})

	test('resolves multiple names independently', () => {
		const result = resolve(
			['web', 'api', 'db'],
			{ web: 'ready', api: 'failed', db: 'running' },
			{ processColors: { db: '#00ff00' }, errored: ['api'] }
		)
		expect(result[0].iconHex).toBe('#00cc00') // ready status color
		expect(result[1].iconHex).toBe('#ff5555') // error override (not failed status)
		expect(result[2].iconHex).toBe('#00ff00') // process color fallback
		expect(result[2].nameHex).toBe('#00ff00')
	})
})
