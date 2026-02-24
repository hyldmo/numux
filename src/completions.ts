import { FLAGS, type FlagDef, SUBCOMMANDS } from './cli-flags'

const SUPPORTED_SHELLS = ['bash', 'zsh', 'fish'] as const

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
	caseEntries.push('    completions)\n      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )\n      return ;;')

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

	lines.push(
		'',
		'# Completions subcommand',
		"complete -c numux -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'",
		'',
		'# Options'
	)

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
