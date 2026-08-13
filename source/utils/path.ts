import {homedir} from 'node:os';
import {resolve, sep} from 'node:path';

export function homeRelative(path: string, home: string = homedir()): string {
	const resolved = resolve(path);
	const resolvedHome = resolve(home);

	if (resolvedHome === sep || /^[A-Za-z]:\\$/.test(resolvedHome)) {
		return resolved;
	}

	if (resolved === resolvedHome) {
		return '~';
	}

	if (resolved.startsWith(resolvedHome + sep)) {
		return `~${resolved.slice(resolvedHome.length)}`;
	}

	return resolved;
}
