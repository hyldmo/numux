import { describe, expect, test } from 'bun:test'
import type { ProcessEvent, ResolvedNumuxConfig } from '../types'
import { ProcessManager } from './manager'

function collectEvents(mgr: ProcessManager): ProcessEvent[] {
	const events: ProcessEvent[] = []
	mgr.on(e => events.push(e))
	return events
}

describe('ProcessManager — initialization', () => {
	test('initializes all states to pending', () => {
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
			processes: { a: { command: 'echo a' } }
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getState('nonexistent')).toBeUndefined()
	})

	test('getProcessNames returns topological order', () => {
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
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

	test('starts dependent as soon as its dependency is ready, not entire tier', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				fast: { command: 'true', persistent: false },
				slow: { command: 'sleep 60', persistent: true },
				child: { command: 'true', persistent: false, dependsOn: ['fast'] }
			}
		}
		const mgr = new ProcessManager(config)
		const startTimes: Record<string, number> = {}
		mgr.on(e => {
			if (e.type === 'status' && e.status === 'starting') {
				startTimes[e.name] = Date.now()
			}
		})

		// Start in background since slow blocks indefinitely
		const startPromise = mgr.startAll(80, 24)

		// Wait for child to start — should happen quickly after fast finishes
		await new Promise(r => setTimeout(r, 1000))

		// child should have started without waiting for slow
		expect(startTimes.child).toBeDefined()
		expect(startTimes.child - startTimes.fast).toBeLessThan(500)
		await mgr.stopAll()
		await startPromise
	}, 10000)
})

describe('ProcessManager — skip propagation', () => {
	test('skips dependents when a dependency fails', async () => {
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
			processes: {
				good: { command: 'true', persistent: false },
				bad: { command: "sh -c 'exit 1'", persistent: false },
				child_of_good: { command: 'true', persistent: false, dependsOn: ['good'] },
				child_of_bad: { command: 'true', persistent: false, dependsOn: ['bad'] }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)

		expect(mgr.getState('good')?.status).toBe('finished')
		expect(mgr.getState('bad')?.status).toBe('failed')
		expect(mgr.getState('child_of_good')?.status).not.toBe('skipped')
		expect(mgr.getState('child_of_bad')?.status).toBe('skipped')
		await mgr.stopAll()
	}, 5000)
})

describe('ProcessManager — event emission', () => {
	test('emits exit events with correct code', async () => {
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
			processes: { a: { command: 'sleep 10' } }
		}
		const mgr = new ProcessManager(config)
		// Should not throw
		mgr.restart('nonexistent', 80, 24)
	})

	test('ignores restart for pending process', () => {
		const config: ResolvedNumuxConfig = {
			processes: { a: { command: 'sleep 10' } }
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getState('a')?.status).toBe('pending')
		mgr.restart('a', 80, 24)
		expect(mgr.getState('a')?.status).toBe('pending')
	})

	test('ignores restart for skipped process', async () => {
		const config: ResolvedNumuxConfig = {
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

describe('ProcessManager — restartAll', () => {
	test('restarts all running processes', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				a: { command: 'sleep 60' },
				b: { command: 'sleep 60' }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		mgr.restartAll(80, 24)
		// Wait for restarts to complete
		await new Promise(r => setTimeout(r, 1000))
		expect(mgr.getState('a')?.restartCount).toBe(1)
		expect(mgr.getState('b')?.restartCount).toBe(1)
		await mgr.stopAll()
	}, 10000)
})

describe('ProcessManager — maxRestarts', () => {
	test('stops auto-restarting after maxRestarts is reached', async () => {
		const config: ResolvedNumuxConfig = {
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
		const config: ResolvedNumuxConfig = {
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
		expect(allOutput).not.toContain('reached restart limit')
		expect(allOutput).not.toContain('restarting in')

		await mgr.stopAll()
	}, 5000)

	test('undefined maxRestarts allows unlimited restarts', async () => {
		const config: ResolvedNumuxConfig = {
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

describe('ProcessManager — stop (individual)', () => {
	test('stops a running process', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				server: { command: 'sleep 60', persistent: true }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)
		expect(mgr.getState('server')?.status).toBe('ready')

		await mgr.stop('server')

		expect(mgr.getState('server')?.status).toBe('stopped')
	}, 10000)

	test('kills process that is still alive after readyTimeout', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				server: {
					command: 'sleep 60',
					persistent: true,
					readyPattern: 'will_never_match',
					readyTimeout: 200
				}
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)

		// Wait for readyTimeout to mark it as failed
		await new Promise(r => setTimeout(r, 500))
		expect(mgr.getState('server')?.status).toBe('failed')

		// Stop should kill the still-running process
		await mgr.stop('server')
		expect(mgr.getState('server')?.status).toBe('stopped')
		await mgr.stopAll()
	}, 10000)

	test('no-op for already finished process', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				task: { command: 'true', persistent: false }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		// Wait for the process to finish
		await new Promise(r => setTimeout(r, 500))
		expect(mgr.getState('task')?.status).toBe('finished')

		// Should not throw
		await mgr.stop('task')
		expect(mgr.getState('task')?.status).toBe('finished')
		await mgr.stopAll()
	}, 5000)

	test('no-op for unknown process', async () => {
		const config: ResolvedNumuxConfig = {
			processes: { a: { command: 'sleep 10' } }
		}
		const mgr = new ProcessManager(config)
		// Should not throw
		await mgr.stop('nonexistent')
		await mgr.stopAll()
	})

	test('no-op for pending process', async () => {
		const config: ResolvedNumuxConfig = {
			processes: { a: { command: 'sleep 10' } }
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getState('a')?.status).toBe('pending')
		await mgr.stop('a')
		expect(mgr.getState('a')?.status).toBe('pending')
	})

	test('cancels pending auto-restart timer', async () => {
		const config: ResolvedNumuxConfig = {
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
		// Wait for crash and auto-restart scheduling
		await new Promise(r => setTimeout(r, 500))

		// Stop should cancel the pending restart
		await mgr.stop('crasher')

		// Wait past when the restart timer would have fired
		await new Promise(r => setTimeout(r, 2000))

		// Should still be stopped, not restarted
		expect(mgr.getState('crasher')?.status).toBe('stopped')
		await mgr.stopAll()
	}, 10000)
})

describe('ProcessManager — start (individual)', () => {
	test('starts a stopped process', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				server: { command: 'sleep 60', persistent: true }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)
		expect(mgr.getState('server')?.status).toBe('ready')

		await mgr.stop('server')
		expect(mgr.getState('server')?.status).toBe('stopped')

		mgr.start('server', 80, 24)
		// Wait for the process to start
		await new Promise(r => setTimeout(r, 500))

		const status = mgr.getState('server')?.status
		expect(status === 'running' || status === 'ready').toBe(true)
		await mgr.stopAll()
	}, 10000)

	test('starts a failed process', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				task: { command: "sh -c 'exit 1'", persistent: false }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)
		expect(mgr.getState('task')?.status).toBe('failed')

		mgr.start('task', 80, 24)
		await new Promise(r => setTimeout(r, 500))

		// Process will fail again, but it should have been started
		expect(mgr.getState('task')?.status).toBe('failed')
		await mgr.stopAll()
	}, 5000)

	test('no-op for running process', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				server: { command: 'sleep 60', persistent: true }
			}
		}
		const mgr = new ProcessManager(config)

		await mgr.startAll(80, 24)
		expect(mgr.getState('server')?.status).toBe('ready')

		// start() should be a no-op since it's already running
		mgr.start('server', 80, 24)
		expect(mgr.getState('server')?.status).toBe('ready')
		await mgr.stopAll()
	}, 5000)

	test('no-op for pending process', () => {
		const config: ResolvedNumuxConfig = {
			processes: { a: { command: 'sleep 10' } }
		}
		const mgr = new ProcessManager(config)
		expect(mgr.getState('a')?.status).toBe('pending')
		mgr.start('a', 80, 24)
		expect(mgr.getState('a')?.status).toBe('pending')
	})

	test('resets backoff counter', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				crasher: { command: "sh -c 'exit 1'", persistent: true, maxRestarts: 1 }
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

		// Wait for crash → auto-restart → crash → maxRestarts reached
		await new Promise(r => setTimeout(r, 3000))
		expect(outputs.join('')).toContain('reached restart limit')

		// Manual start should reset the backoff counter
		mgr.start('crasher', 80, 24)
		await new Promise(r => setTimeout(r, 500))

		// Process should have been started (and failed again)
		const status = mgr.getState('crasher')?.status
		expect(status === 'failed' || status === 'starting').toBe(true)
		await mgr.stopAll()
	}, 10000)
})

describe('ProcessManager — delay', () => {
	test('delays process start by the configured amount', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				fast: { command: 'true', persistent: false },
				slow: { command: 'true', persistent: false, delay: 500 }
			}
		}
		const mgr = new ProcessManager(config)
		const startTimes: Record<string, number> = {}
		mgr.on(e => {
			if (e.type === 'status' && e.status === 'starting') {
				startTimes[e.name] = Date.now()
			}
		})

		await mgr.startAll(80, 24)

		// slow should have started at least 400ms after fast (allowing 100ms tolerance)
		expect(startTimes.slow - startTimes.fast).toBeGreaterThanOrEqual(400)
		await mgr.stopAll()
	}, 10000)

	test('delay does not block other processes in the same tier', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				a: { command: 'true', persistent: false, delay: 500 },
				b: { command: 'true', persistent: false }
			}
		}
		const mgr = new ProcessManager(config)
		const startTimes: Record<string, number> = {}
		mgr.on(e => {
			if (e.type === 'status' && e.status === 'starting') {
				startTimes[e.name] = Date.now()
			}
		})

		const before = Date.now()
		await mgr.startAll(80, 24)

		// b should start nearly immediately (not blocked by a's delay)
		expect(startTimes.b - before).toBeLessThan(200)
		// a should be delayed
		expect(startTimes.a - before).toBeGreaterThanOrEqual(400)
		await mgr.stopAll()
	}, 10000)

	test('stopAll cancels pending delay timer', async () => {
		const config: ResolvedNumuxConfig = {
			processes: {
				delayed: { command: 'sleep 60', persistent: true, delay: 2000 }
			}
		}
		const mgr = new ProcessManager(config)

		// Start in background — don't await since the delay means it won't resolve quickly
		const startPromise = mgr.startAll(80, 24)

		// Stop before the delay completes
		await new Promise(r => setTimeout(r, 100))
		await mgr.stopAll()

		// Process should never have started (still pending since we stopped during delay)
		const status = mgr.getState('delayed')?.status
		expect(status === 'pending' || status === 'stopped').toBe(true)

		// Clean up the startAll promise
		await startPromise
	}, 5000)
})

describe('ProcessManager — condition', () => {
	test('skips process when condition env var is unset', async () => {
		delete process.env.NUMUX_TEST_CONDITION
		const config: ResolvedNumuxConfig = {
			processes: {
				guarded: { command: 'true', persistent: false, condition: 'NUMUX_TEST_CONDITION' }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		expect(mgr.getState('guarded')?.status).toBe('skipped')
		await mgr.stopAll()
	}, 5000)

	test('runs process when condition env var is truthy', async () => {
		process.env.NUMUX_TEST_CONDITION = '1'
		const config: ResolvedNumuxConfig = {
			processes: {
				guarded: { command: 'true', persistent: false, condition: 'NUMUX_TEST_CONDITION' }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		expect(mgr.getState('guarded')?.status).not.toBe('skipped')
		delete process.env.NUMUX_TEST_CONDITION
		await mgr.stopAll()
	}, 5000)

	test('skips process when condition env var is "false"', async () => {
		process.env.NUMUX_TEST_CONDITION = 'false'
		const config: ResolvedNumuxConfig = {
			processes: {
				guarded: { command: 'true', persistent: false, condition: 'NUMUX_TEST_CONDITION' }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		expect(mgr.getState('guarded')?.status).toBe('skipped')
		delete process.env.NUMUX_TEST_CONDITION
		await mgr.stopAll()
	}, 5000)

	test('negated condition runs when env var is unset', async () => {
		delete process.env.NUMUX_TEST_CONDITION
		const config: ResolvedNumuxConfig = {
			processes: {
				guarded: { command: 'true', persistent: false, condition: '!NUMUX_TEST_CONDITION' }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		expect(mgr.getState('guarded')?.status).not.toBe('skipped')
		await mgr.stopAll()
	}, 5000)

	test('negated condition skips when env var is truthy', async () => {
		process.env.NUMUX_TEST_CONDITION = 'yes'
		const config: ResolvedNumuxConfig = {
			processes: {
				guarded: { command: 'true', persistent: false, condition: '!NUMUX_TEST_CONDITION' }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		expect(mgr.getState('guarded')?.status).toBe('skipped')
		delete process.env.NUMUX_TEST_CONDITION
		await mgr.stopAll()
	}, 5000)

	test('skipped condition cascades to dependents', async () => {
		delete process.env.NUMUX_TEST_CONDITION
		const config: ResolvedNumuxConfig = {
			processes: {
				parent: { command: 'true', persistent: false, condition: 'NUMUX_TEST_CONDITION' },
				child: { command: 'true', persistent: false, dependsOn: ['parent'] }
			}
		}
		const mgr = new ProcessManager(config)
		await mgr.startAll(80, 24)

		expect(mgr.getState('parent')?.status).toBe('skipped')
		expect(mgr.getState('child')?.status).toBe('skipped')
		await mgr.stopAll()
	}, 5000)
})

describe('ProcessManager — stopAll', () => {
	test('stops a running process', async () => {
		const config: ResolvedNumuxConfig = {
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
