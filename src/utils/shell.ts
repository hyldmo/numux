/**
 * Cross-platform shell invocation.
 *
 * `sh` is not guaranteed on Windows, so arbitrary command strings run under
 * `cmd.exe` there and under `sh` everywhere else. Callers must author
 * commands that work in both shells (e.g. `bun -e "..."`) for truly
 * portable configs.
 */
export function shellArgv(command: string, platform: NodeJS.Platform = process.platform): string[] {
	if (platform === 'win32') return ['cmd', '/d', '/s', '/c', command]
	return ['sh', '-c', command]
}
