import { describe, expect, test } from 'bun:test'
import type { ProcessStatus } from '../types'
import { ProcessRunner, type RunnerEventHandler } from './runner'

function createHandler(): RunnerEventHandler & {
	statuses: ProcessStatus[]
	outputs: string[]
	exits: Array<number | null>
	readyCount: number
} {
	const decoder = new TextDecoder()
	const handler = {
		statuses: [] as ProcessStatus[],
		outputs: [] as string[],
		exits: [] as Array<number | null>,
		readyCount: 0,
		onStatus(status: ProcessStatus) {
			handler.statuses.push(status)
		},
		onOutput(data: Uint8Array) {
			handler.outputs.push(decoder.decode(data))
		},
		onExit(code: number | null) {
			handler.exits.push(code)
		},
		onReady() {
			handler.readyCount++
		}
	}
	return handler
}

/** Wait for the handler to record an exit event */
function waitForExit(handler: ReturnType<typeof createHandler>, timeoutMs = 5000): Promise<void> {
	return new Promise((resolve, reject) => {
		const start = Date.now()
		const check = () => {
			if (handler.exits.length > 0) return resolve()
			if (Date.now() - start > timeoutMs) return reject(new Error('Timed out waiting for exit'))
			setTimeout(check, 10)
		}
		check()
	})
}

describe('ProcessRunner — persistent process', () => {
	test('becomes ready immediately when no readyPattern', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('srv', { command: 'sleep 10', persistent: true }, handler)

		runner.start(80, 24)
		// Wait a tick for status events
		await new Promise(r => setTimeout(r, 50))

		expect(handler.statuses).toContain('running')
		expect(handler.statuses).toContain('ready')
		expect(runner.isReady).toBe(true)
		expect(handler.readyCount).toBe(1)

		await runner.stop()
	}, 5000)

	test('becomes ready when readyPattern matches output', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner(
			'srv',
			{
				command: "echo 'server listening on port 3000' && sleep 10",
				persistent: true,
				readyPattern: 'listening on port \\d+'
			},
			handler
		)

		runner.start(80, 24)

		// Wait for pattern match
		await new Promise<void>((resolve, reject) => {
			const start = Date.now()
			const check = () => {
				if (runner.isReady) return resolve()
				if (Date.now() - start > 3000) return reject(new Error('Timed out waiting for ready'))
				setTimeout(check, 10)
			}
			check()
		})

		expect(handler.statuses).toContain('ready')
		expect(handler.readyCount).toBe(1)

		await runner.stop()
	}, 5000)

	test('reports failed status on non-zero exit', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('fail', { command: "sh -c 'exit 1'", persistent: true }, handler)

		runner.start(80, 24)
		await waitForExit(handler)

		expect(handler.exits[0]).toBe(1)
		expect(handler.statuses).toContain('failed')
	}, 5000)

	test('reports stopped status on clean exit', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('ok', { command: 'true', persistent: true }, handler)

		runner.start(80, 24)
		await waitForExit(handler)

		expect(handler.exits[0]).toBe(0)
		expect(handler.statuses).toContain('stopped')
	}, 5000)
})

describe('ProcessRunner — non-persistent process', () => {
	test('becomes ready on exit code 0', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('task', { command: 'true', persistent: false }, handler)

		runner.start(80, 24)
		await waitForExit(handler)

		expect(runner.isReady).toBe(true)
		expect(handler.readyCount).toBe(1)
		expect(handler.statuses).toContain('ready')
		expect(handler.statuses).toContain('stopped')
	}, 5000)

	test('does not become ready on non-zero exit', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('task', { command: "sh -c 'exit 1'", persistent: false }, handler)

		runner.start(80, 24)
		await waitForExit(handler)

		expect(runner.isReady).toBe(false)
		expect(handler.readyCount).toBe(0)
		expect(handler.statuses).toContain('failed')
	}, 5000)
})

describe('ProcessRunner — readyTimeout', () => {
	test('marks process as failed when readyPattern not matched within timeout', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner(
			'srv',
			{
				command: 'sleep 60',
				persistent: true,
				readyPattern: 'will_never_match',
				readyTimeout: 200
			},
			handler
		)

		runner.start(80, 24)

		// Wait for timeout to fire
		await new Promise(r => setTimeout(r, 500))

		expect(handler.statuses).toContain('failed')
		expect(handler.readyCount).toBe(1) // onReady called to unblock tier
		expect(runner.isReady).toBe(false) // but runner is not actually ready

		const allOutput = handler.outputs.join('')
		expect(allOutput).toContain('readyPattern not matched')

		await runner.stop()
	}, 5000)

	test('does not emit duplicate failed status when timed-out process exits', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner(
			'srv',
			{
				command: 'sleep 0.5',
				persistent: true,
				readyPattern: 'will_never_match',
				readyTimeout: 200
			},
			handler
		)

		runner.start(80, 24)

		// Wait for readyTimeout to fire AND for the process to exit
		await new Promise(r => setTimeout(r, 1500))

		// Only one 'failed' status should be emitted (from readyTimeout, not from exit)
		const failedCount = handler.statuses.filter(s => s === 'failed').length
		expect(failedCount).toBe(1)

		// No exit event should be emitted after readyTimeout
		expect(handler.exits).toHaveLength(0)
	}, 5000)

	test('does not fire timeout if readyPattern matches in time', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner(
			'srv',
			{
				command: "echo 'ready!' && sleep 60",
				persistent: true,
				readyPattern: 'ready!',
				readyTimeout: 5000
			},
			handler
		)

		runner.start(80, 24)

		// Wait for pattern match
		await new Promise<void>((resolve, reject) => {
			const start = Date.now()
			const check = () => {
				if (runner.isReady) return resolve()
				if (Date.now() - start > 3000) return reject(new Error('Timed out waiting for ready'))
				setTimeout(check, 10)
			}
			check()
		})

		expect(handler.statuses).toContain('ready')
		expect(handler.statuses).not.toContain('failed')

		await runner.stop()
	}, 5000)

	test('does not apply timeout to non-persistent processes', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner(
			'task',
			{
				command: 'true',
				persistent: false,
				readyTimeout: 100
			},
			handler
		)

		runner.start(80, 24)
		await waitForExit(handler)

		// Should become ready via exit code, not timeout
		expect(runner.isReady).toBe(true)
		expect(handler.statuses).not.toContain('failed')
	}, 5000)
})

describe('ProcessRunner — spawn errors', () => {
	test('shows hint on exit code 127 (command not found)', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('bad', { command: 'nonexistent_cmd_xyz', persistent: true }, handler)

		runner.start(80, 24)
		await waitForExit(handler)

		expect(handler.exits[0]).toBe(127)
		expect(handler.statuses).toContain('failed')
		const allOutput = handler.outputs.join('')
		expect(allOutput).toContain('command not found')
	}, 5000)

	test('handles invalid cwd gracefully', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner(
			'bad',
			{ command: 'echo hello', persistent: true, cwd: '/nonexistent_dir_xyz' },
			handler
		)

		runner.start(80, 24)

		// Either Bun.spawn throws (caught) or process exits with error
		await new Promise(r => setTimeout(r, 500))

		const allOutput = handler.outputs.join('')
		expect(handler.statuses).toContain('failed')
		expect(allOutput.length).toBeGreaterThan(0)
	}, 5000)
})

describe('ProcessRunner — output', () => {
	test('captures process output', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('echo', { command: 'echo hello_world', persistent: false }, handler)

		runner.start(80, 24)
		await waitForExit(handler)

		const allOutput = handler.outputs.join('')
		expect(allOutput).toContain('hello_world')
	}, 5000)
})

describe('ProcessRunner — restart', () => {
	test('restart stops and re-starts the process', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('srv', { command: 'sleep 60', persistent: true }, handler)

		runner.start(80, 24)
		await new Promise(r => setTimeout(r, 100))
		expect(runner.isReady).toBe(true)

		await runner.restart(80, 24)
		await new Promise(r => setTimeout(r, 100))

		// Should have gone through stopping → starting → running → ready again
		expect(handler.statuses).toContain('stopping')
		expect(handler.statuses.filter(s => s === 'ready').length).toBeGreaterThanOrEqual(2)
		expect(runner.isReady).toBe(true)

		await runner.stop()
	}, 10000)
})

describe('ProcessRunner — stop', () => {
	test('stop is a no-op when no process is running', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('srv', { command: 'sleep 10', persistent: true }, handler)

		// Never started — stop should not throw
		await runner.stop()
		expect(handler.statuses).toHaveLength(0)
	})

	test('stop sends SIGTERM and process exits gracefully', async () => {
		const handler = createHandler()
		const runner = new ProcessRunner('srv', { command: 'sleep 60', persistent: true }, handler)

		runner.start(80, 24)
		await new Promise(r => setTimeout(r, 100))

		await runner.stop()

		expect(handler.statuses).toContain('stopping')
		expect(handler.statuses).toContain('stopped')
	}, 5000)
})
