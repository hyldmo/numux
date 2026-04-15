import { FLAGS, type FlagDef, SUBCOMMANDS, type SubcommandDef } from './cli-flags'
import { HELP_TOPICS, TOPIC_ALIASES } from './generated/help-topics'

const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish'] as const

const HELP_TOPIC_NAMES = [...Object.keys(HELP_TOPICS), ...Object.keys(TOPIC_ALIASES)]

/** Resolve completionArgs for a subcommand — expands 'dynamic' for help using generated topics */
function resolveArgs(sub: SubcommandDef): string[] | 'dynamic' | undefined {
	if (!sub.completionArgs) return undefined
	if (sub.completionArgs === 'dynamic' && sub.name === 'help') return HELP_TOPIC_NAMES
	return sub.completionArgs
}

export function generateCompletions(shell: string): string {
	switch (shell) {
		case 'bash':
			return bashCompletions()
		case 'zsh':
			return zshCompletions()
		case 'fish':
			return fishCompletions()
		default:
			throw new Error(`Unknown shell: "${shell}". Supported: ${SUPPORTED_SHELLS.join(', ')}`)
	}
}

/** Strip leading dashes: '--foo' → 'foo' */
function longName(f: FlagDef): string {
	return f.long.replace(/^-+/, '')
}

/** Escape single quotes for shell strings: ' → '\'' */
function sq(s: string): string {
	return s.replace(/'/g, "'\\''")
}

function bashCompletions(): string {
	// Case entries for value flags
	const caseEntries: string[] = []
	for (const f of FLAGS) {
		if (f.type !== 'value') continue
		const names = f.short ? `${f.short}|${f.long}` : f.long
		if (f.completionHint === 'file') {
			caseEntries.push(`    ${names})\n      COMPREPLY=( $(compgen -f -- "$cur") )\n      return ;;`)
		} else if (f.completionHint === 'directory') {
			caseEntries.push(`    ${names})\n      COMPREPLY=( $(compgen -d -- "$cur") )\n      return ;;`)
		} else {
			caseEntries.push(`    ${names})\n      return ;;`)
		}
	}

	// Subcommand argument completions — generated from SubcommandDef.completionArgs
	for (const sub of SUBCOMMANDS) {
		const args = resolveArgs(sub)
		if (!args) continue
		if (args === 'dynamic') {
			const script = sub.completionScript
			if (!script) continue
			const dir = `$(${script})`
			caseEntries.push(
				`    ${sub.name})\n      local logdir\n      logdir="${dir}"\n      if [ -n "$logdir" ] && [ -d "$logdir" ]; then\n        local names\n        names="$(ls "$logdir"/*.log 2>/dev/null | xargs -I{} basename {} .log)"\n        COMPREPLY=( $(compgen -W "$names" -- "$cur") )\n      fi\n      return ;;`
			)
		} else {
			caseEntries.push(
				`    ${sub.name})\n      COMPREPLY=( $(compgen -W "${args.join(' ')}" -- "$cur") )\n      return ;;`
			)
		}
	}

	// All flag names for compgen
	const allFlags = FLAGS.flatMap(f => (f.short ? [f.short, f.long] : [f.long]))
	const subcmds = SUBCOMMANDS.map(s => s.name)

	return `# numux bash completions
# Add to ~/.bashrc: eval "$(numux completions bash)"
_numux() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
${caseEntries.join('\n')}
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "${allFlags.join(' ')}" -- "$cur") )
  else
    local subcmds="${subcmds.join(' ')}"
    COMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )
  fi
}
complete -F _numux numux`
}

function zshCompletions(): string {
	const subcmdLines = SUBCOMMANDS.map(s => `    '${s.name}:${sq(s.description)}'`).join('\n')

	const argLines: string[] = []
	for (const f of FLAGS) {
		const desc = sq(f.description)
		if (f.short) {
			if (f.type === 'value') {
				let suffix = ''
				if (f.completionHint === 'file') suffix = ':file:_files'
				else if (f.completionHint === 'directory') suffix = ':directory:_directories'
				else suffix = `:${longName(f)}`
				argLines.push(`    '(${f.short} ${f.long})'{${f.short},${f.long}}'[${desc}]${suffix}'`)
			} else {
				argLines.push(`    '(${f.short} ${f.long})'{${f.short},${f.long}}'[${desc}]'`)
			}
		} else {
			if (f.type === 'value') {
				let suffix = ''
				if (f.completionHint === 'file') suffix = ':file:_files'
				else if (f.completionHint === 'directory') suffix = ':directory:_directories'
				else suffix = `:${longName(f)}`
				argLines.push(`    '${f.long}[${desc}]${suffix}'`)
			} else {
				argLines.push(`    '${f.long}[${desc}]'`)
			}
		}
	}

	// Join with ' \' line continuation
	const argsBlock = argLines.map(l => `${l} \\`).join('\n')

	// Subcommand argument completions
	const subcmdCases: string[] = []
	for (const sub of SUBCOMMANDS) {
		const args = resolveArgs(sub)
		if (!args) continue
		if (args === 'dynamic') {
			const script = sub.completionScript
			if (!script) continue
			subcmdCases.push(
				`    ${sub.name})\n      local logdir names\n      logdir="\\$(${script})"\n      if [[ -n "\\$logdir" ]] && [[ -d "\\$logdir" ]]; then\n        names=( \\$(ls "\\$logdir"/*.log 2>/dev/null | xargs -I{} basename {} .log) )\n        _describe 'process' names\n      fi\n      ;;`
			)
		} else {
			subcmdCases.push(
				`    ${sub.name})\n      local -a args\n      args=(${args.map(a => `'${a}'`).join(' ')})\n      _describe '${sub.name}' args\n      ;;`
			)
		}
	}

	return `#compdef numux
# numux zsh completions
# Add to ~/.zshrc: eval "$(numux completions zsh)"
_numux() {
  local -a subcmds
  subcmds=(
${subcmdLines}
  )

  _arguments -s \\
${argsBlock}
    '1:subcommand:->subcmd' \\
    '*:command' \\
    && return

  case "$state" in
    subcmd)
      _describe 'subcommand' subcmds
      ;;
  esac

  case "\${words[2]}" in
${subcmdCases.join('\n')}
  esac
}
_numux`
}

function fishCompletions(): string {
	const lines = [
		'# numux fish completions',
		'# Add to fish: numux completions fish | source',
		'# Or save to: ~/.config/fish/completions/numux.fish',
		'complete -c numux -f',
		'',
		'# Subcommands'
	]

	for (const s of SUBCOMMANDS) {
		lines.push(`complete -c numux -n __fish_use_subcommand -a ${s.name} -d '${sq(s.description)}'`)
	}

	// Subcommand argument completions
	for (const sub of SUBCOMMANDS) {
		const args = resolveArgs(sub)
		if (!args) continue
		lines.push('')
		lines.push(`# ${sub.name} subcommand`)
		if (args === 'dynamic') {
			const script = sub.completionScript
			if (!script) continue
			lines.push(
				`complete -c numux -n '__fish_seen_subcommand_from ${sub.name}' -a '(set -l d (${script}); and ls $d/*.log 2>/dev/null | xargs -I{} basename {} .log)'`
			)
		} else {
			lines.push(`complete -c numux -n '__fish_seen_subcommand_from ${sub.name}' -a '${args.join(' ')}'`)
		}
	}

	lines.push('', '# Options')

	for (const f of FLAGS) {
		const parts = ['complete -c numux']
		if (f.short) parts.push(`-s ${f.short.replace('-', '')}`)
		parts.push(`-l ${longName(f)}`)
		if (f.type === 'value') {
			if (f.completionHint === 'file') {
				parts.push('-rF')
			} else if (f.completionHint === 'directory') {
				parts.push("-ra '(__fish_complete_directories)'")
			} else {
				parts.push('-r')
			}
		}
		parts.push(`-d '${sq(f.description)}'`)
		lines.push(parts.join(' '))
	}

	return lines.join('\n')
}
