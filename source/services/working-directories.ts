import {realpathSync, statSync} from 'node:fs';
import {relative, resolve} from 'node:path';
import {
	ensureDirectoryTrust,
	untrustedDirectoryMessage,
} from '@/config/trust/directory-trust';
import {defineSessionValue} from '@/services/session-context';
import {getProjectRoot, getSessionCwd} from '@/services/session-cwd';
import {
	isPathInside,
	normalizeForCompare,
	realResolvedPrefix,
	resolveFilePath,
} from '@/utils/fs/path-validation';

export interface WorkingDirectory {
	path: string;
	mode?: 'read-write' | 'read-only';
}

const additionalDirectories = defineSessionValue<WorkingDirectory[]>();
const cliDirectories = defineSessionValue<WorkingDirectory[]>();

export function setCliDirectories(directories: WorkingDirectory[]): void {
	cliDirectories.set(directories);
}
export function getCliDirectories(): WorkingDirectory[] {
	return cliDirectories.get() ?? [];
}
export function resetWorkingDirectories(): void {
	additionalDirectories.reset();
	cliDirectories.reset();
}
export function getWorkingDirectories(): WorkingDirectory[] {
	const primary = getProjectRoot();
	const directories = additionalDirectories.get() ?? [];
	const sameAsPrimary = (directory: WorkingDirectory) =>
		normalizeForCompare(directory.path) ===
		normalizeForCompare(realResolvedPrefix(primary));
	const primaryGrant = directories.find(sameAsPrimary);
	return [
		{path: primary, mode: primaryGrant?.mode ?? 'read-write'},
		...directories.filter(directory => !sameAsPrimary(directory)),
	];
}

export function getWorkingRoots(): string[] {
	return getWorkingDirectories().map(directory => directory.path);
}

export function prepareWorkingDirectory(
	directory: WorkingDirectory,
): WorkingDirectory {
	const absolute = resolve(getProjectRoot(), directory.path);
	if (!directory.path.trim() || !statSync(absolute).isDirectory()) {
		throw new Error(`Not a directory: ${directory.path}`);
	}
	return {path: realpathSync(absolute), mode: directory.mode ?? 'read-write'};
}

/** Only called by startup or a user command, never by a model tool. */
export function addWorkingDirectory(
	directory: WorkingDirectory,
	bypass = false,
	checkTrust: typeof ensureDirectoryTrust = ensureDirectoryTrust,
): WorkingDirectory {
	const prepared = prepareWorkingDirectory(directory);
	const trust = checkTrust(prepared.path, bypass);
	if (!trust.trusted)
		throw new Error(untrustedDirectoryMessage(prepared.path, trust.recheck));
	const directories = additionalDirectories.get() ?? [];
	const existing = directories.find(
		entry =>
			normalizeForCompare(entry.path) === normalizeForCompare(prepared.path),
	);
	// Repeated additions cannot silently upgrade a read-only grant.
	if (existing) {
		if (prepared.mode === 'read-only') existing.mode = 'read-only';
	} else {
		directories.push(prepared);
	}
	additionalDirectories.set(directories);
	return existing ?? prepared;
}

export function resolveWorkingPath(filePath: string): string {
	return resolveFilePath(filePath, getSessionCwd(), getWorkingRoots());
}

export function assertWritablePath(filePath: string): void {
	const target = realResolvedPrefix(resolveWorkingPath(filePath));
	for (const directory of getWorkingDirectories()) {
		if (directory.mode === 'read-only') {
			const root = realResolvedPrefix(directory.path);
			// A recursive operation on a parent can mutate a read-only descendant too.
			if (isPathInside(target, root) || isPathInside(root, target)) {
				throw new Error(
					`Cannot write to read-only directory: ${directory.path}`,
				);
			}
		}
	}
}

export function formatWorkingDirectoriesContext(): string {
	const directories = getWorkingDirectories();
	if (directories.length === 1 && directories[0].mode === 'read-write')
		return '';
	return [
		'Working directories (use absolute paths for files outside the primary project):',
		...directories.map(directory => `${directory.path} (${directory.mode})`),
	].join('\n');
}

/** Nested roots apply their own ignore rules, even when a parent is also active. */
export function getContainingWorkingRoot(target: string): string {
	const realTarget = realResolvedPrefix(target);
	return (
		getWorkingRoots()
			.map(path => ({path, real: realResolvedPrefix(path)}))
			.filter(root => isPathInside(realTarget, root.real))
			.sort((a, b) => b.real.length - a.real.length)[0]?.path ??
		getProjectRoot()
	);
}

/** Discovery does not follow symlinks; compute root ownership once per traversal. */
export function createWorkingDirectoryFilter(
	searchRoot: string,
): (target: string) => boolean {
	const roots = getWorkingRoots()
		.map(root => realResolvedPrefix(root))
		.sort((a, b) => b.length - a.length);
	const realSearchRoot = realResolvedPrefix(searchRoot);
	const owner = (target: string) =>
		roots.find(root => isPathInside(target, root));
	const searchOwner = owner(realSearchRoot);
	return target =>
		owner(resolve(realSearchRoot, relative(searchRoot, target))) ===
		searchOwner;
}

export function getNestedWorkingRoots(searchRoot: string): string[] {
	const realRoot = realResolvedPrefix(searchRoot);
	return getWorkingRoots()
		.map(root => realResolvedPrefix(root))
		.filter(
			root =>
				normalizeForCompare(root) !== normalizeForCompare(realRoot) &&
				isPathInside(root, realRoot),
		)
		.map(root => resolve(searchRoot, relative(realRoot, root)));
}
