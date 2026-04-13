import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { FLAGS, SUBCOMMANDS } from '../src/cli-flags'
import { STATUS_HINTS } from '../src/ui/keybindings'
import { STATUS_ICONS } from '../src/ui/tabs'

const ROOT = join(import.meta.dir, '..')

// --- Options table ---

function generateOptionsTable(): string {
	const rows: string[] = ['| Flag | Description |', '|------|-------------|']
	for (const f of FLAGS) {
		const parts: string[] = []
		if (f.short) parts.push(`\`${f.short},\``)
		parts.push(`\`${f.long}\``)
		if (f.type === 'value') parts.push(`\`${f.valueName}\``)
		if (f.type === 'optional-value') parts.push(`\`[${f.valueName}]\``)
		rows.push(`| ${parts.join(' ')} | ${f.description} |`)
	}
	return rows.join('\n')
}

// --- Subcommands block ---

function generateSubcommandsBlock(): string {
	const PAD = 35
	const lines = SUBCOMMANDS.map(s => {
		const usage = `numux ${s.usage ?? s.name}`
		return `${usage.padEnd(PAD)}# ${s.description}`
	})
	return `\`\`\`sh\n${lines.join('\n')}\n\`\`\``
}

// --- Keybindings table ---

function generateKeybindingsTable(): string {
	const rows: string[] = ['| Key | Action |', '|-----|--------|']
	for (const [label, desc] of STATUS_HINTS) {
		const key = label === '\u2190\u2192/1-9' ? '`\u2190`/`\u2192` or `1`-`9`' : `\`${label}\``
		const action = desc.charAt(0).toUpperCase() + desc.slice(1)
		rows.push(`| ${key} | ${action} |`)
	}
	return rows.join('\n')
}

// --- Tab icons table ---

function generateTabIconsTable(): string {
	const rows: string[] = ['| Icon | Status |', '|------|--------|']
	for (const [status, icon] of Object.entries(STATUS_ICONS)) {
		const label = status.charAt(0).toUpperCase() + status.slice(1)
		rows.push(`| ${icon} | ${label} |`)
	}
	return rows.join('\n')
}

// --- Type parsing helpers ---

interface FieldDoc {
	name: string
	type: string
	defaultVal: string | null
	description: string
}

/** Known type aliases to expand for readability */
const TYPE_ALIASES: Record<string, string> = {
	SortOrder: "'config' | 'alphabetical' | 'topological'",
	Color: 'string'
}

function cleanType(raw: string): string {
	// Strip NoInfer<X> -> X
	let t = raw.replace(/NoInfer<([^>]+)>/g, '$1')
	// Replace generic type parameters (K, K[]) with string equivalents
	t = t.replace(/\bK\b\[\]/g, 'string[]').replace(/\bK\b/g, 'string')
	// Strip trailing semicolons
	t = t.replace(/;$/, '').trim()
	// Expand known type aliases
	for (const [alias, expanded] of Object.entries(TYPE_ALIASES)) {
		if (t === alias) return expanded
		// e.g. Color | Color[]
		t = t.replace(new RegExp(`\\b${alias}\\b`, 'g'), expanded)
	}
	return t
}

function parseInterfaceFields(src: string, interfaceName: string): FieldDoc[] {
	// Find the interface body
	const ifaceRe = new RegExp(`interface ${interfaceName}[^{]*\\{([\\s\\S]*?)^\\}`, 'm')
	const match = ifaceRe.exec(src)
	if (!match) throw new Error(`Interface ${interfaceName} not found`)
	const body = match[1]

	const fields: FieldDoc[] = []
	const lines = body.split('\n')

	let jsdocLines: string[] = []
	let inJsdoc = false

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]
		const trimmed = line.trim()

		// Single-line JSDoc: /** text */ or /** text @default val */
		const singleLine = /^\/\*\*\s*(.*?)\s*\*\/$/.exec(trimmed)
		if (singleLine) {
			jsdocLines = [singleLine[1]]
			continue
		}

		if (trimmed === '/**') {
			inJsdoc = true
			jsdocLines = []
			continue
		}
		if (inJsdoc) {
			if (trimmed === '*/') {
				inJsdoc = false
				continue
			}
			jsdocLines.push(trimmed.replace(/^\*\s?/, ''))
			continue
		}

		// Field declaration line: name?: Type or name: Type
		const fieldRe = /^\s*(\w+)\??\s*:\s*(.+)$/
		const fm = fieldRe.exec(line)
		if (!fm) {
			if (trimmed && !trimmed.startsWith('//')) jsdocLines = []
			continue
		}

		const name = fm[1]
		const rawType = fm[2].replace(/;$/, '').trim()
		const type = cleanType(rawType)

		// Parse jsdoc
		let defaultVal: string | null = null
		const descParts: string[] = []
		for (const jl of jsdocLines) {
			if (jl.startsWith('@default ')) {
				defaultVal = jl.slice('@default '.length).trim()
			} else if (jl.startsWith('@example')) {
				// skip example lines
			} else if (jl.startsWith('@')) {
				// skip other tags
			} else if (jl) {
				descParts.push(jl)
			}
		}
		const description = descParts.join(' ').trim()

		fields.push({ name, type, defaultVal, description })
		jsdocLines = []
	}

	return fields
}

// --- Process options table ---

function generateProcessOptionsTable(): string {
	const src = readFileSync(join(ROOT, 'src/types.ts'), 'utf8')
	const fields = parseInterfaceFields(src, 'NumuxProcessConfig')

	const rows: string[] = ['| Field | Type | Default | Description |', '|-------|------|---------|-------------|']

	for (const f of fields) {
		const rawDef = f.name === 'command' ? '*required*' : (f.defaultVal ?? '\u2014')
		// Wrap plain code values (numbers, quoted strings, booleans) in backticks
		const def = rawDef === '*required*' || rawDef === '\u2014' ? rawDef : `\`${rawDef}\``
		const type = f.type.replace(/\|/g, '\\|')
		rows.push(`| \`${f.name}\` | \`${type}\` | ${def} | ${f.description} |`)
	}

	return rows.join('\n')
}

// --- Global options table ---

function generateGlobalOptionsTable(): string {
	const src = readFileSync(join(ROOT, 'src/types.ts'), 'utf8')
	const fields = parseInterfaceFields(src, 'NumuxConfig')

	const rows: string[] = ['| Field | Type | Description |', '|-------|------|-------------|']

	for (const f of fields) {
		if (f.name === 'processes') continue
		const type = f.type.replace(/\|/g, '\\|')
		rows.push(`| \`${f.name}\` | \`${type}\` | ${f.description} |`)
	}

	return rows.join('\n')
}

// --- Script pattern rules ---

function generateScriptPatternRules(): string {
	const src = readFileSync(join(ROOT, 'src/config/expand-scripts.ts'), 'utf8')

	// Extract the JSDoc block directly above expandScriptPatterns.
	// Find the function declaration first, then look backwards for its JSDoc.
	const funcIdx = src.indexOf('export function expandScriptPatterns')
	if (funcIdx === -1) throw new Error('expandScriptPatterns not found')

	const before = src.slice(0, funcIdx)
	const jsdocEnd = before.lastIndexOf('*/\n')
	if (jsdocEnd === -1) throw new Error('expandScriptPatterns JSDoc not found')

	const jsdocStart = before.lastIndexOf('/**\n', jsdocEnd)
	if (jsdocStart === -1) throw new Error('expandScriptPatterns JSDoc not found')

	const jsdocBlock = before.slice(jsdocStart + 4, jsdocEnd)

	// Clean JSDoc: strip leading ` * ` prefix from each line
	const raw = jsdocBlock
		.split('\n')
		.map(line => line.replace(/^ \* ?/, ''))
		.join('\n')
		.trim()

	// Only include content starting from "## Script pattern rules"
	const rulesStart = raw.indexOf('## Script pattern rules')
	if (rulesStart === -1) throw new Error('## Script pattern rules heading not found in JSDoc')

	return raw.slice(rulesStart)
}

// --- README section replacement ---

function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function replaceSection(readme: string, name: string, content: string): string {
	const open = `<!-- generated:${name} -->`
	const close = `<!-- /generated:${name} -->`
	const re = new RegExp(`${escapeRegex(open)}\n[\\s\\S]*?${escapeRegex(close)}`)
	if (!re.test(readme)) {
		throw new Error(`Marker not found: ${name}`)
	}
	return readme.replace(re, `${open}\n${content}\n${close}`)
}

function updateReadme(): void {
	const readmePath = join(ROOT, 'README.md')
	let readme = readFileSync(readmePath, 'utf8')

	readme = replaceSection(readme, 'subcommands', generateSubcommandsBlock())
	readme = replaceSection(readme, 'options', generateOptionsTable())
	readme = replaceSection(readme, 'config-global', generateGlobalOptionsTable())
	readme = replaceSection(readme, 'config-process', generateProcessOptionsTable())
	readme = replaceSection(readme, 'script-pattern-rules', generateScriptPatternRules())
	readme = replaceSection(readme, 'keybindings', generateKeybindingsTable())
	readme = replaceSection(readme, 'tab-icons', generateTabIconsTable())

	writeFileSync(readmePath, readme, 'utf8')
}

// --- Help topics ---

const TOPIC_ALIASES: Record<string, string> = {
	keys: 'keybindings',
	icons: 'tab-icons',
	deps: 'dependency-orchestration',
	'env-interpolation': 'environment-variable-interpolation'
}

function slugify(heading: string): string {
	return heading
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
}

function generateHelpTopics(): void {
	const outDir = join(ROOT, 'src/generated')
	mkdirSync(outDir, { recursive: true })

	const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')

	// Split on ## or ### headings
	const parts = readme.split(/(?=^#{2,3} )/m)

	interface HelpTopic {
		title: string
		body: string
	}

	const topics: Record<string, HelpTopic> = {}

	for (const part of parts) {
		const headingMatch = /^(#{2,3}) (.+)/.exec(part)
		if (!headingMatch) continue

		const title = headingMatch[2].trim()
		const body = part.slice(headingMatch[0].length).trim()

		if (!body) continue

		const slug = slugify(title)
		topics[slug] = { title, body }
	}

	// Serialize topics to TS source with tab indentation, single quotes, no semicolons
	const topicEntries = Object.entries(topics)
		.map(([slug, t]) => {
			const escapedTitle = t.title.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
			const escapedBody = t.body.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\${/g, '\\${')
			return `\t'${slug}': { title: '${escapedTitle}', body: \`${escapedBody}\` }`
		})
		.join(',\n')

	const aliasEntries = Object.entries(TOPIC_ALIASES)
		.map(([alias, target]) => `\t'${alias}': '${target}'`)
		.join(',\n')

	const out = [
		'// This file is auto-generated by scripts/generate-docs.ts — do not edit',
		'',
		'export interface HelpTopic { title: string; body: string }',
		'',
		'export const TOPIC_ALIASES: Record<string, string> = {',
		aliasEntries,
		'}',
		'',
		'export const HELP_TOPICS: Record<string, HelpTopic> = {',
		topicEntries,
		'}',
		''
	].join('\n')

	const outPath = join(outDir, 'help-topics.ts')
	writeFileSync(outPath, out, 'utf8')
}

// --- Man page ---

function generateManPage(): void {
	const readmePath = join(ROOT, 'README.md')
	const manDir = join(ROOT, 'man')
	mkdirSync(manDir, { recursive: true })

	const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

	const result = Bun.spawnSync(
		[
			'bunx',
			'marked-man',
			'--name',
			'NUMUX',
			'--version',
			pkg.version,
			'--section',
			'1',
			'--manual',
			'numux manual'
		],
		{ stdin: Bun.file(readmePath) }
	)

	if (result.exitCode !== 0) {
		throw new Error(`marked-man failed: ${result.stderr.toString()}`)
	}

	writeFileSync(join(manDir, 'numux.1'), result.stdout)
}

if (import.meta.main) {
	updateReadme()
	generateHelpTopics()
	generateManPage()
}
