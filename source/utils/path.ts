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

export function truncateMiddle(str: string, maxLength: number): string {
	if (str.length <= maxLength) {
		return str;
	}

	const ellipsis = '...';
	if (maxLength <= ellipsis.length) {
		return str.slice(0, Math.max(0, maxLength));
	}

	const keepStart = Math.ceil((maxLength - ellipsis.length) / 2);
	const keepEnd = Math.floor((maxLength - ellipsis.length) / 2);

	return str.slice(0, keepStart) + ellipsis + str.slice(str.length - keepEnd);
}
