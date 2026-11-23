/** Environment variable that carries the command to the inner cmd.exe. */
const CMD_SCRIPT_ENV = 'NC_CMD_SCRIPT';

/**
 * cmd.exe writes in the console's code page (437, 936, ...), but command
 * output is decoded as UTF-8. cmd.exe reads the code page once at start-up, so
 * an outer cmd.exe switches its console to UTF-8 (65001) and then starts the
 * cmd.exe that runs the command. The command reaches the inner cmd.exe through
 * {@link CMD_SCRIPT_ENV} and delayed expansion, which happens after the outer
 * cmd.exe has parsed its own line, so the outer one never interprets the
 * command's quotes or operators. Spawn with `windowsHide: true` so the code
 * page change stays in the child's own console instead of the user's.
 */
const CMD_UTF8_WRAPPER = `"chcp 65001 >nul 2>&1 & cmd /d /v:off /s /c !${CMD_SCRIPT_ENV}!"`;

/**
 * cmd.exe: disable AutoRun, switch the console to UTF-8, then run one wrapped
 * command (with delayed expansion off) given by {@link shellEnv}.
 */
export function shellArgs(shell: string, script: string): string[] {
	return isWindowsCmd(shell)
		? ['/d', '/v:on', '/s', '/c', CMD_UTF8_WRAPPER]
		: ['-c', script];
}

/** Environment the shell from {@link shellArgs} needs to run `script`. */
export function shellEnv(
	shell: string,
	script: string,
): Record<string, string> {
	return isWindowsCmd(shell) ? {[CMD_SCRIPT_ENV]: `"${script}"`} : {};
}

export function isWindowsCmd(shell: string): boolean {
	const name = shell.replaceAll('\\', '/').split('/').pop() ?? '';
	return /^cmd(\.exe)?$/i.test(name);
}
