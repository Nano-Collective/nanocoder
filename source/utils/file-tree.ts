import {lstat, readdir} from 'node:fs/promises';
import {join, relative} from 'node:path';
import {loadGitignore} from '@/utils/gitignore-loader';

export interface FileNode {
	name: string;
	path: string; // Relative path from root
	absolutePath: string;
	isDirectory: boolean;
	size?: number;
	children?: FileNode[];
}

export interface FlatNode {
	node: FileNode;
	depth: number;
	isExpanded: boolean;
	hasChildren: boolean;
}

/**
 * Build a file tree from a root directory
 * Respects gitignore and excludes hidden files by default
 */
export async function buildFileTree(
	rootPath: string,
	options: {
		maxDepth?: number;
		showHidden?: boolean;
	} = {},
): Promise<FileNode[]> {
	const {maxDepth = 10, showHidden = false} = options;
	const ig = loadGitignore(rootPath);

	const walkDirectory = async (
		currentPath: string,
		relativeTo: string,
		depth: number,
	): Promise<FileNode[]> => {
		if (depth > maxDepth) return [];

		try {
			const items = await readdir(currentPath, {withFileTypes: true});
			const nodes: FileNode[] = [];

			for (const item of items) {
				// Skip hidden files unless showHidden is true
				if (!showHidden && item.name.startsWith('.')) {
					continue;
				}

				// Check gitignore
				const itemPath = relativeTo ? join(relativeTo, item.name) : item.name;
				if (ig.ignores(itemPath)) {
					continue;
				}

				const fullPath = join(currentPath, item.name);
				const isDirectory = item.isDirectory();

				let size: number | undefined;
				if (!isDirectory) {
					try {
						const stats = await lstat(fullPath);
						size = stats.size;
					} catch {
						size = undefined;
					}
				}

				const node: FileNode = {
					name: item.name,
					path: itemPath,
					absolutePath: fullPath,
					isDirectory,
					size,
				};

				// Recursively build children for directories
				if (isDirectory && depth < maxDepth) {
					node.children = await walkDirectory(fullPath, itemPath, depth + 1);
				}

				nodes.push(node);
			}

			// Sort: directories first, then alphabetically
			nodes.sort((a, b) => {
				if (a.isDirectory && !b.isDirectory) return -1;
				if (!a.isDirectory && b.isDirectory) return 1;
				return a.name.localeCompare(b.name);
			});

			return nodes;
		} catch (error: unknown) {
			if (
				error instanceof Error &&
				'code' in error &&
				error.code === 'EACCES'
			) {
				return [];
			}
			throw error;
		}
	};

	return walkDirectory(rootPath, '', 0);
}

/**
 * Flatten a file tree into a list for rendering
 * Only includes visible nodes based on expanded state
 */
export function flattenTree(
	nodes: FileNode[],
	expanded: Set<string>,
	depth = 0,
): FlatNode[] {
	const result: FlatNode[] = [];

	for (const node of nodes) {
		const isExpanded = expanded.has(node.path);
		const hasChildren = node.isDirectory && (node.children?.length ?? 0) > 0;

		result.push({
			node,
			depth,
			isExpanded,
			hasChildren,
		});

		// Add children if directory is expanded
		if (node.isDirectory && isExpanded && node.children) {
			result.push(...flattenTree(node.children, expanded, depth + 1));
		}
	}

	return result;
}

/**
 * Flatten entire file tree (all nodes regardless of expansion)
 * Used for searching across all files
 */
export function flattenTreeAll(nodes: FileNode[], depth = 0): FlatNode[] {
	const result: FlatNode[] = [];

	for (const node of nodes) {
		const hasChildren = node.isDirectory && (node.children?.length ?? 0) > 0;

		result.push({
			node,
			depth,
			isExpanded: false,
			hasChildren,
		});

		// Always recurse into children
		if (node.isDirectory && node.children) {
			result.push(...flattenTreeAll(node.children, depth + 1));
		}
	}

	return result;
}

/**
 * Get relative path from cwd
 */
export function getRelativePath(absolutePath: string): string {
	return relative(process.cwd(), absolutePath);
}
