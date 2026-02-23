import { describe, expect, test } from 'bun:test'
import type { NumuxConfig, ProcessEvent } from '../types'
import { ProcessManager } from './manager'

function collectEvents(mgr: ProcessManager): ProcessEvent[] {
	const events: ProcessEvent[] = []
	mgr.on(e => events.push(e))
	return events
}

describe('ProcessManager — initialization', () => {
	test('initializes all states to pending', () => {
		const config: NumuxConfig = {
			processes: {
				a: { command: 'echo a' },
				b: { command: 'echo b' }
			}
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getState('a')?.status).toBe('pending')
		expect(mgr.getState('b')?.status).toBe('pending')
	})

	test('getAllStates returns all process states', () => {
		const config: NumuxConfig = {
			processes: {
				x: { command: 'echo x' },
				y: { command: 'echo y' },
				z: { command: 'echo z' }
			}
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getAllStates()).toHaveLength(3)
	})

	test('getState returns undefined for unknown process', () => {
		const config: NumuxConfig = {
			processes: { a: { command: 'echo a' } }
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getState('nonexistent')).toBeUndefined()
	})

	test('getProcessNames returns topological order', () => {
		const config: NumuxConfig = {
			processes: {
				web: { command: 'echo web', dependsOn: ['api'] },
				api: { command: 'echo api', dependsOn: ['db'] },
				db: { command: 'echo db' }
			}
		}
		const mgr = new ProcessManager(config)
		const names = mgr.getProcessNames()
		expect(names.indexOf('db')).toBeLessThan(names.indexOf('api'))
		expect(names.indexOf('api')).toBeLessThan(names.indexOf('web'))
	})

	test('getProcessNames groups independent processes in same tier', () => {
		const config: NumuxConfig = {
			processes: {
				a: { command: 'echo a' },
				b: { command: 'echo b' },
				c: { command: 'echo c', dependsOn: ['a', 'b'] }
			}
		}
		const mgr = new ProcessManager(config)
		const names = mgr.getProcessNames()
		// a and b should both come before c
		expect(names.indexOf('a')).toBeLessThan(names.indexOf('c'))
		expect(names.indexOf('b')).toBeLessThan(names.indexOf('c'))
	})
})

describe('ProcessManager — startAll', () => {
	test('starts a non-persistent process and completes', async () => {
		const config: NumuxConfig = {
			processes: {
				task: { command: 'true', persistent: false }
			}
		}
		const mgr = new ProcessManager(config)
		const events = collectEvents(mgr)

		await mgr.startAll(80, 24)

		const statusEvents = events.filter(e => e.type === 'status' && e.name === 'task')
		const statuses = statusEvents.map(e => (e as { status: string }).status)
		expect(statuses).toContain('starting')
		expect(statuses).toContain('ready')
		await mgr.stopAll()
	}, 5000)

	test('persistent process without readyPattern becomes ready immediately', async () => {
		const config: NumuxConfig = {
			processes: {
				server: { command: 'sleep 10', persistent: true }
			}
		}
		const mgr = new ProcessManager(config)
		const events = collectEvents(mgr)

		await mgr.startAll(80, 24)

		const statuses = events
			.filter(e => e.type === 'status' && e.name === 'server')
			.map(e => (e as { status: string }).status)
		expect(statuses).toContain('running')
		expect(statuses).toContain('ready')
		await mgr.stopAll()
	}, 5000)

	test('respects dependency order across tiers', async () => {
		const config: NumuxConfig = {
			processes: {
				dep: { command: 'true', persistent: false },
				child: { command: 'true', persistent: false, dependsOn: ['dep'] }
			}
		}
		const mgr = new ProcessManager(config)
		const readyOrder: string[] = []
		mgr.on(e => {
			if (e.type === 'status' && e.status === 'ready') {
				readyOrder.push(e.name)
			}
		})

		await mgr.startAll(80, 24)

		expect(readyOrder.indexOf('dep')).toBeLessThan(readyOrder.indexOf('child'))
		await mgr.stopAll()
	}, 5000)
})

describe('ProcessManager — skip propagation', () => {
	test('skips dependents when a dependency fails', async () => {
		const config: NumuxConfig = {
			processes: {
				failing: { command: "sh -c 'exit 1'", persistent: false },
				child: { command: 'true', persistent: false, dependsOn: ['failing'] }
			}
		}
		const mgr = new ProcessManager(config)
		const events = collectEvents(mgr)

		await mgr.startAll(80, 24)

		expect(mgr.getState('failing')?.status).toBe('failed')
		expect(mgr.getState('child')?.status).toBe('skipped')

		// Verify skip event was emitted
		const skipEvent = events.find(e => e.type === 'status' && e.name === 'child' && e.status === 'skipped')
		expect(skipEvent).toBeDefined()
		await mgr.stopAll()
	}, 5000)

	test('skips transitive dependents', async () => {
		const config: NumuxConfig = {
			processes: {
				root: { command: "sh -c 'exit 1'", persistent: false },
				mid: { command: 'true', persistent: false, dependsOn: ['root'] },
				leaf: { command: 'true', persistent: false, dependsOn: ['mid'] }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)

		expect(mgr.getState('root')?.status).toBe('failed')
		expect(mgr.getState('mid')?.status).toBe('skipped')
		expect(mgr.getState('leaf')?.status).toBe('skipped')
		await mgr.stopAll()
	}, 5000)

	test('only skips affected branch, not siblings', async () => {
		const config: NumuxConfig = {
			processes: {
				good: { command: 'true', persistent: false },
				bad: { command: "sh -c 'exit 1'", persistent: false },
				child_of_good: { command: 'true', persistent: false, dependsOn: ['good'] },
				child_of_bad: { command: 'true', persistent: false, dependsOn: ['bad'] }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)

		expect(mgr.getState('good')?.status).toBe('stopped')
		expect(mgr.getState('bad')?.status).toBe('failed')
		expect(mgr.getState('child_of_good')?.status).not.toBe('skipped')
		expect(mgr.getState('child_of_bad')?.status).toBe('skipped')
		await mgr.stopAll()
	}, 5000)
})

describe('ProcessManager — event emission', () => {
	test('emits exit events with correct code', async () => {
		const config: NumuxConfig = {
			processes: {
				ok: { command: 'true', persistent: false },
				fail: { command: "sh -c 'exit 42'", persistent: false }
			}
		}
		const mgr = new ProcessManager(config)
		const exits: Array<{ name: string; code: number | null }> = []
		mgr.on(e => {
			if (e.type === 'exit') {
				exits.push({ name: e.name, code: e.code })
			}
		})

		await mgr.startAll(80, 24)

		const okExit = exits.find(e => e.name === 'ok')
		const failExit = exits.find(e => e.name === 'fail')
		expect(okExit?.code).toBe(0)
		expect(failExit?.code).toBe(42)
		await mgr.stopAll()
	}, 5000)
})

describe('ProcessManager — manual restart', () => {
	test('ignores restart for unknown process', () => {
		const config: NumuxConfig = {
			processes: { a: { command: 'sleep 10' } }
		}
		const mgr = new ProcessManager(config)
		// Should not throw
		mgr.restart('nonexistent', 80, 24)
	})

	test('ignores restart for pending process', () => {
		const config: NumuxConfig = {
			processes: { a: { command: 'sleep 10' } }
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getState('a')?.status).toBe('pending')
		mgr.restart('a', 80, 24)
		expect(mgr.getState('a')?.status).toBe('pending')
	})

	test('ignores restart for skipped process', async () => {
		const config: NumuxConfig = {
			processes: {
				dep: { command: "sh -c 'exit 1'", persistent: false },
				child: { command: 'true', persistent: false, dependsOn: ['dep'] }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		expect(mgr.getState('child')?.status).toBe('skipped')
		mgr.restart('child', 80, 24)
		expect(mgr.getState('child')?.status).toBe('skipped')
		await mgr.stopAll()
	}, 5000)
})

describe('ProcessManager — maxRestarts', () => {
	test('stops auto-restarting after maxRestarts is reached', async () => {
		const config: NumuxConfig = {
			processes: {
				crasher: { command: "sh -c 'exit 1'", persistent: true, maxRestarts: 2 }
			}
		}
		const mgr = new ProcessManager(config)
		const outputs: string[] = []
		const decoder = new TextDecoder()
		mgr.on(e => {
			if (e.type === 'output' && e.name === 'crasher') {
				outputs.push(decoder.decode(e.data))
			}
		})

		await mgr.startAll(80, 24)

		// Wait for backoff timers: attempt 1 at 1s, attempt 2 at 2s, then limit
		await new Promise(r => setTimeout(r, 4500))

		const allOutput = outputs.join('')
		// Should see "attempt 1/2" and "attempt 2/2" restart messages
		expect(allOutput).toContain('attempt 1/2')
		expect(allOutput).toContain('attempt 2/2')
		// Should see the "giving up" message
		expect(allOutput).toContain('reached restart limit')
		// Should NOT see attempt 3
		expect(allOutput).not.toContain('attempt 3')

		await mgr.stopAll()
	}, 10000)

	test('maxRestarts: 0 prevents any auto-restart', async () => {
		const config: NumuxConfig = {
			processes: {
				crasher: { command: "sh -c 'exit 1'", persistent: true, maxRestarts: 0 }
			}
		}
		const mgr = new ProcessManager(config)
		const outputs: string[] = []
		const decoder = new TextDecoder()
		mgr.on(e => {
			if (e.type === 'output' && e.name === 'crasher') {
				outputs.push(decoder.decode(e.data))
			}
		})

		await mgr.startAll(80, 24)
		await new Promise(r => setTimeout(r, 500))

		const allOutput = outputs.join('')
		expect(allOutput).toContain('reached restart limit')
		expect(allOutput).not.toContain('restarting in')

		await mgr.stopAll()
	}, 5000)

	test('undefined maxRestarts allows unlimited restarts', async () => {
		const config: NumuxConfig = {
			processes: {
				crasher: { command: "sh -c 'exit 1'", persistent: true }
			}
		}
		const mgr = new ProcessManager(config)
		const outputs: string[] = []
		const decoder = new TextDecoder()
		mgr.on(e => {
			if (e.type === 'output' && e.name === 'crasher') {
				outputs.push(decoder.decode(e.data))
			}
		})

		await mgr.startAll(80, 24)
		// Wait long enough for at least 2 restarts (1s + 2s backoff)
		await new Promise(r => setTimeout(r, 4000))

		const allOutput = outputs.join('')
		expect(allOutput).toContain('attempt 1')
		expect(allOutput).toContain('attempt 2')
		expect(allOutput).not.toContain('giving up')

		await mgr.stopAll()
	}, 10000)
})

describe('ProcessManager — stopAll', () => {
	test('stops a running process', async () => {
		const config: NumuxConfig = {
			processes: {
				server: { command: 'sleep 60', persistent: true }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)
		expect(mgr.getState('server')?.status).toBe('ready')

		await mgr.stopAll()

		const status = mgr.getState('server')?.status
		expect(status === 'stopped' || status === 'stopping').toBe(true)
	}, 10000)
})
