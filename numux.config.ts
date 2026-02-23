export default {
	processes: {
		server: {
			command: 'echo "Starting server..." && sleep 1 && echo "listening on port 3000" && sleep 999',
			readyPattern: 'listening on port 3000'
		},
		worker: {
			command:
				'echo "Worker started, waiting for server..." && while true; do echo "worker tick $(date +%T)"; sleep 2; done',
			dependsOn: ['server']
		},
		setup: {
			command: 'echo "Running setup..." && sleep 2 && echo "Setup complete"',
			persistent: false
		}
	}
}
