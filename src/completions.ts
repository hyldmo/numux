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

function bashCompletions(): string {
	return `# numux bash completions
# Add to ~/.bashrc: eval "$(numux completions bash)"
_numux() {
  local cur prev
  cur="\${COMP_WORDS[COMP_CWORD]}"
  prev="\${COMP_WORDS[COMP_CWORD-1]}"

  case "$prev" in
    --config)
      COMPREPLY=( $(compgen -f -- "$cur") )
      return ;;
    --log-dir)
      COMPREPLY=( $(compgen -d -- "$cur") )
      return ;;
    --only|--exclude)
      return ;;
    -n|--name)
      return ;;
    completions)
      COMPREPLY=( $(compgen -W "bash zsh fish" -- "$cur") )
      return ;;
  esac

  if [[ "$cur" == -* ]]; then
    COMPREPLY=( $(compgen -W "-h --help -v --version -c --color --config -n --name -p --prefix --only --exclude --kill-others --no-restart --no-watch -t --timestamps --log-dir --debug" -- "$cur") )
  else
    local subcmds="init validate exec completions"
    COMPREPLY=( $(compgen -W "$subcmds" -- "$cur") )
  fi
}
complete -F _numux numux`
}

function zshCompletions(): string {
	return `#compdef numux
# numux zsh completions
# Add to ~/.zshrc: eval "$(numux completions zsh)"
_numux() {
  local -a subcmds
  subcmds=(
    'init:Create a starter config file'
    'validate:Validate config and show process graph'
    'exec:Run a command in a process environment'
    'completions:Generate shell completions'
  )

  _arguments -s \\
    '(-h --help)'{-h,--help}'[Show help]' \\
    '(-v --version)'{-v,--version}'[Show version]' \\
    '(-c --color)'{-c,--color}'[Comma-separated colors for processes]' \\
    '--config[Config file path]:file:_files' \\
    '(-n --name)'{-n,--name}'[Named process (name=command)]:named process' \\
    '(-p --prefix)'{-p,--prefix}'[Prefixed output mode]' \\
    '--only[Only run these processes]:processes' \\
    '--exclude[Exclude these processes]:processes' \\
    '--kill-others[Kill all when any exits]' \\
    '--no-restart[Disable auto-restart]' \\
    '--no-watch[Disable file watching]' \\
    '(-t --timestamps)'{-t,--timestamps}'[Add timestamps to output]' \\
    '--log-dir[Log directory]:directory:_directories' \\
    '--debug[Enable debug logging]' \\
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
	return `# numux fish completions
# Add to fish: numux completions fish | source
# Or save to: ~/.config/fish/completions/numux.fish
complete -c numux -f

# Subcommands
complete -c numux -n __fish_use_subcommand -a init -d 'Create a starter config file'
complete -c numux -n __fish_use_subcommand -a validate -d 'Validate config and show process graph'
complete -c numux -n __fish_use_subcommand -a exec -d 'Run a command in a process environment'
complete -c numux -n __fish_use_subcommand -a completions -d 'Generate shell completions'

# Completions subcommand
complete -c numux -n '__fish_seen_subcommand_from completions' -a 'bash zsh fish'

# Options
complete -c numux -s h -l help -d 'Show help'
complete -c numux -s v -l version -d 'Show version'
complete -c numux -s c -l color -r -d 'Comma-separated colors for processes'
complete -c numux -l config -rF -d 'Config file path'
complete -c numux -s n -l name -r -d 'Named process (name=command)'
complete -c numux -s p -l prefix -d 'Prefixed output mode'
complete -c numux -l only -r -d 'Only run these processes'
complete -c numux -l exclude -r -d 'Exclude these processes'
complete -c numux -l kill-others -d 'Kill all when any exits'
complete -c numux -l no-restart -d 'Disable auto-restart'
complete -c numux -l no-watch -d 'Disable file watching'
complete -c numux -s t -l timestamps -d 'Add timestamps to output'
complete -c numux -l log-dir -ra '(__fish_complete_directories)' -d 'Log directory'
complete -c numux -l debug -d 'Enable debug logging'`
}
