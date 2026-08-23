import {execFileSync} from 'node:child_process';

let cachedPath: string | undefined;

function systemRipgrepPath(): string | undefined {
	const command = process.platform === 'win32' ? 'rg.exe' : 'rg';
	try {
		const output = execFileSync(command, ['--version'], {encoding: 'utf8'});
		// A PATH entry named `rg`/`rg.exe` isn't necessarily BurntSushi's
		// ripgrep - verify it before trusting its flags (--json, -g, etc).
		if (!output.startsWith('ripgrep ')) {
			return undefined;
		}
		return command;
	} catch {
		return undefined;
	}
}

export async function resolveRipgrepPath(): Promise<string> {
	if (cachedPath) {
		return cachedPath;
	}

	const system = systemRipgrepPath();
	if (system) {
		cachedPath = system;
		return cachedPath;
	}

	const {rgPath} = await import('@vscode/ripgrep');
	cachedPath = rgPath;
	return cachedPath;
}
