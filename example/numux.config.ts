import { defineConfig } from '../src/config'

export default defineConfig({
	processes: {
		db: {
			command: 'bun servers/db.ts',
			readyPattern: 'ready to accept connections',
			color: '#4fc3f7'
		},
		migrate: {
			command: 'bun servers/migrate.ts',
			dependsOn: ['db'],
			persistent: false
		},
		api: {
			command: 'bun servers/api.ts',
			dependsOn: ['migrate'],
			readyPattern: 'listening on http://localhost:3000',
			color: '#81c784'
		},
		worker: {
			command: 'bun servers/worker.ts',
			dependsOn: ['db'],
			color: '#ce93d8'
		}
	}
})
