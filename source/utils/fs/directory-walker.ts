import {lstat, readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {addNestedGitignore, loadGitignore} from '@/utils/fs/gitignore-loader';
import {isPathInside} from '@/utils/fs/path-validation';

export interface DirectoryEntry {
	name: string;
	relativePath: string;
	type: 'file' | 'directory' | 'symlink';
	size?: number;
}

export interface WalkDirectoryOptions {
	root: string;
	dirPath: string;
	recursive?: boolean;
	maxDepth?: number;
	showHiddenFiles?: boolean;
	showSizes?: boolean;
	maxEntries?: number;
}

export interface WalkDirectoryResult {
	entries: DirectoryEntry[];
	hitCap: boolean;
}

interface DirectoryQueueItem {
	currentPath: string;
	relativeTo: string;
	depth: number;
}

/**
 * Breadth-first directory walker respecting .gitignore, .nanocoderignore,
 * depth limits, and entry limits.
 */
export async function walkDirectory(
	options: WalkDirectoryOptions,
): Promise<WalkDirectoryResult> {
	const {
		root,
		dirPath,
		recursive = false,
		maxDepth = 3,
		showHiddenFiles = false,
		showSizes = false,
		maxEntries,
	} = options;

	const isInsideRoot = isPathInside(dirPath, root);
	const ignoreBase = isInsideRoot ? root : dirPath;
	const ig = loadGitignore(ignoreBase);

	const listingHiddenDir = /(^|[/\\])\.[^./\\]/.test(
		relative(ignoreBase, dirPath),
	);

	if (isInsideRoot) {
		const listedSegments = relative(root, dirPath)
			.split(/[/\\]/)
			.filter(Boolean);
		for (let depth = 1; depth < listedSegments.length; depth++) {
			const ancestor = listedSegments.slice(0, depth);
			await addNestedGitignore(ig, join(root, ...ancestor), ancestor.join('/'));
		}
	}

	const entries: DirectoryEntry[] = [];
	let hitCap = false;

	const queue: DirectoryQueueItem[] = [
		{
			currentPath: dirPath,
			relativeTo: '',
			depth: 0,
		},
	];

	while (queue.length > 0) {
		const current = queue.shift();
		if (!current || current.depth > maxDepth) {
			continue;
		}

		try {
			await addNestedGitignore(
				ig,
				current.currentPath,
				relative(ignoreBase, current.currentPath).replace(/\\/g, '/'),
			);

			const items = await readdir(current.currentPath, {withFileTypes: true});

			items.sort((a, b) => {
				if (a.isDirectory() && !b.isDirectory()) return -1;
				if (!a.isDirectory() && b.isDirectory()) return 1;
				return a.name.localeCompare(b.name);
			});

			for (const item of items) {
				if (maxEntries !== undefined && entries.length >= maxEntries) {
					hitCap = true;
					break;
				}

				// Skip hidden files unless showHiddenFiles is true or explicitly listing a hidden dir
				if (
					!showHiddenFiles &&
					item.name.startsWith('.') &&
					!listingHiddenDir
				) {
					continue;
				}

				const fullPath = join(current.currentPath, item.name);
				const isDir = item.isDirectory();
				const ignorePath = relative(ignoreBase, fullPath).replace(/\\/g, '/');

				if (ig.ignores(ignorePath) || (isDir && ig.ignores(`${ignorePath}/`))) {
					continue;
				}

				let type: 'file' | 'directory' | 'symlink' = 'file';
				if (item.isSymbolicLink()) {
					type = 'symlink';
				} else if (isDir) {
					type = 'directory';
				}

				const relativePath = current.relativeTo
					? `${current.relativeTo}/${item.name}`
					: item.name;

				let size: number | undefined;
				if (type === 'file' && showSizes) {
					try {
						const stats = await lstat(fullPath);
						size = stats.size;
					} catch {
						size = undefined;
					}
				}

				entries.push({
					name: item.name,
					relativePath,
					type,
					size,
				});

				if (recursive && isDir && current.depth < maxDepth) {
					queue.push({
						currentPath: fullPath,
						relativeTo: relativePath,
						depth: current.depth + 1,
					});
				}
			}

			if (hitCap) {
				break;
			}
		} catch (error: unknown) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'EACCES'
			) {
				continue;
			}
			throw error;
		}
	}

	return {entries, hitCap};
}
