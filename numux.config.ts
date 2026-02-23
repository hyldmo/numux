export default {
	processes: {
		db: {
			command: 'echo "Starting database..." && sleep 1 && echo "ready to accept connections" && sleep 999',
			readyPattern: 'ready to accept connections',
			color: '#4fc3f7'
		},
		migrate: {
			command: 'echo "Running migrations..." && sleep 1 && echo "Migrations complete."',
			dependsOn: ['db'],
			persistent: false
		},
		api: {
			command: 'echo "Booting API..." && sleep 1 && echo "listening on port 3000" && sleep 999',
			dependsOn: ['migrate'],
			readyPattern: 'listening on port 3000',
			color: '#81c784'
		},
		web: {
			command: 'echo "Starting dev server..." && sleep 1 && echo "ready on http://localhost:5173" && sleep 999',
			dependsOn: ['api'],
			color: '#ce93d8'
		}
	}
}
