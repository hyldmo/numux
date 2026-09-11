/**
 * Cross-platform shell invocation, mirroring how Node.js `exec` runs
 * commands on Windows.
 *
 * POSIX uses `sh -c`. On Windows the command runs under `cmd.exe`, wrapped
 * in one outer pair of quotes with {@link shellSpawnOptions} disabling
 * Bun's MSVCRT-style escaping: without verbatim passthrough, inner quotes
 * are backslash-escaped (which `cmd.exe` does not understand) and the tail
 * silently degrades — e.g. `bun -e "..."` runs as bare `bun` and exits 0.
 *
 * Callers must still author commands that work in both shells (e.g.
 * `bun -e "..."`); `$VAR`, single quotes, and `;` are `sh`-only while `%VAR%`
 * is `cmd`-only.
 */
export function shellArgv(command: string, platform: NodeJS.Platform = process.platform): string[] {
	if (platform === 'win32') return ['cmd', '/d', '/s', '/c', `"${command}"`]
	return ['sh', '-c', command]
}

type SpawnOptions = Parameters<typeof Bun.spawn>[1]

/** Extra `Bun.spawn` options required for {@link shellArgv} commands. */
export function shellSpawnOptions(platform: NodeJS.Platform = process.platform): SpawnOptions {
	if (platform === 'win32') return { windowsVerbatimArguments: true } as SpawnOptions
	return {}
}
