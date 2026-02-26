import { defineConfig } from '../src/config'

export default defineConfig({
	env: {
		NODE_ENV: 'development'
	},
	processes: {
		debug: {
			command: 'mkdir -p .numux && touch .numux/debug.log && tail -f .numux/debug.log',
			color: '#888888'
		},
		db: {
			command: 'bun servers/db.ts',
			readyPattern: 'ready to accept connections',
			readyTimeout: 10000,
			color: '#4fc3f7'
		},
		migrate: {
			command: 'bun servers/migrate.ts',
			dependsOn: 'db',
			persistent: false
		},
		api: {
			command: 'bun servers/api.ts',
			dependsOn: 'migrate',
			readyPattern: /listening on (?<url>http:\/\/\S+)/,
			errorMatcher: true,
			stopSignal: 'SIGINT',
			watch: ['servers/**/*.ts'],
			color: '#81c784'
		},
		worker: {
			command: 'bun servers/worker.ts',
			dependsOn: 'db',
			maxRestarts: 5,
			color: '#ce93d8'
		},
		e2e: {
			command: 'bun servers/e2e.ts',
			dependsOn: ['api', 'db'],
			env: { BASE_URL: '$api.url' },
			persistent: false,
			condition: 'RUN_E2E',
			color: '#fff176'
		},
		deploy: {
			command: 'bun servers/prompt.ts',
			interactive: true,
			persistent: false,
			color: '#ffb74d'
		}
	}
})
