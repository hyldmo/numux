import { HELP_TOPICS, TOPIC_ALIASES } from './generated/help-topics'

function stripMarkdown(md: string): string {
	return md
		// biome-ignore lint/suspicious/noControlCharactersInRegex: intentional HTML comment removal
		.replace(/<!--[\s\S]*?-->/g, '')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/\*(.+?)\*/g, '$1')
		.replace(/`([^`]+)`/g, '$1')
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}

export function showHelp(topic?: string): string {
	if (!topic) {
		const entries = Object.entries(HELP_TOPICS)
			.map(([slug, t]) => `  ${slug.padEnd(40)}${t.title}`)
			.join('\n')

		const aliases = Object.entries(TOPIC_ALIASES)
			.map(([alias, target]) => `  ${alias} → ${target}`)
			.join('\n')

		return `Available help topics:\n\n${entries}\n\nAliases:\n${aliases}\n\nUsage: numux help <topic>`
	}

	const resolved = TOPIC_ALIASES[topic] ?? topic
	const entry = HELP_TOPICS[resolved]
	if (!entry) {
		const available = Object.keys(HELP_TOPICS).join(', ')
		return `Unknown topic: "${topic}"\n\nAvailable topics: ${available}`
	}

	return `${entry.title}\n${'='.repeat(entry.title.length)}\n\n${stripMarkdown(entry.body)}`
}
