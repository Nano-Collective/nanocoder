import path from 'node:path';

let restrictedScope: readonly string[] | undefined;

/** `''` stands for the whole project. */
export function normalizeScopeEntry(entry: string): string {
	const normalized = path.posix
		.normalize(entry.trim().replace(/\\/g, '/'))
		.replace(/(\/\*\*)+$/, '')
		.replace(/\/+$/, '');
	return normalized === '.' || normalized === '**' ? '' : normalized;
}

/** Both arguments are project-relative, and `scope` is already normalized. */
export function isPathInScope(
	relativePath: string,
	scope: readonly string[],
): boolean {
	const target = relativePath.replace(/\\/g, '/');
	if (target === '..' || target.startsWith('../')) return false;
	if (path.isAbsolute(relativePath)) return false;
	return scope.some(
		entry => entry === '' || target === entry || target.startsWith(`${entry}/`),
	);
}

/**
 * Limits the file editing tools of this process to the given paths. Shell
 * commands are not covered.
 */
export function setRestrictedScope(scope: readonly string[] | undefined): void {
	restrictedScope = scope?.map(normalizeScopeEntry);
}

export function getRestrictedScope(): readonly string[] | undefined {
	return restrictedScope;
}
