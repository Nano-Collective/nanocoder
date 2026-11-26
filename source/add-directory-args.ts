import type {WorkingDirectory} from './services/working-directories.js';

/** Keep parsing independent of the startup module graph. */
export function parseAdditionalDirectoryArgs(
	args: readonly string[],
): WorkingDirectory[] {
	const directories: WorkingDirectory[] = [];
	for (let index = 0; index < args.length; index++) {
		const argument = args[index];
		const flag = argument.split('=', 1)[0];
		if (flag !== '--add-dir' && flag !== '--add-dir-ro') continue;
		const value = argument.includes('=')
			? argument.slice(flag.length + 1)
			: args[++index];
		if (!value?.trim() || value === 'run' || value.startsWith('--')) {
			throw new Error(`${flag} requires a directory path.`);
		}
		directories.push({
			path: value,
			mode: flag === '--add-dir-ro' ? 'read-only' : 'read-write',
		});
	}
	return directories;
}
