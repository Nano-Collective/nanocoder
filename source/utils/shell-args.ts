/** cmd.exe: disable AutoRun/delayed expansion, then run one wrapped command. */
export function shellArgs(shell: string, script: string): string[] {
	return isWindowsCmd(shell)
		? ['/d', '/v:off', '/s', '/c', `"${script}"`]
		: ['-c', script];
}

export function isWindowsCmd(shell: string): boolean {
	const name = shell.replaceAll('\\', '/').split('/').pop() ?? '';
	return /^cmd(\.exe)?$/i.test(name);
}
