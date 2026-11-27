/**
 * Built-in tools that change the files named in their arguments. Every place
 * that needs to know which files a call changed (the `--json` report's
 * `filesChanged`, ACP timeline checkpoints) reads this one list, so a new
 * file tool cannot be counted by one and missed by another.
 */
const FILE_MUTATING_TOOLS: ReadonlySet<string> = new Set([
	'write_file',
	'string_replace',
	'diff_edit',
	'lsp_format_document',
	'file_op',
]);

export function isFileMutatingTool(toolName: string): boolean {
	return FILE_MUTATING_TOOLS.has(toolName);
}

/**
 * The paths a call of a file-mutating tool changes, as the model wrote them.
 * Empty for any other tool, and for `file_op mkdir`, which creates a
 * directory rather than changing a file. A `copy` changes only its
 * destination; a `move` changes both ends.
 */
export function fileMutationPaths(
	toolName: string,
	args: Record<string, unknown> | undefined,
): string[] {
	if (!args || !FILE_MUTATING_TOOLS.has(toolName)) {
		return [];
	}

	const paths: string[] = [];
	if (toolName === 'file_op') {
		const {operation, path, destination} = args;
		if (operation === 'mkdir') {
			return [];
		}
		if (operation !== 'copy' && typeof path === 'string' && path) {
			paths.push(path);
		}
		if (
			(operation === 'move' || operation === 'copy') &&
			typeof destination === 'string' &&
			destination
		) {
			paths.push(destination);
		}
		return paths;
	}

	if (typeof args.path === 'string' && args.path) {
		paths.push(args.path);
	}
	// write_file accepts `file_path` as a legacy alias.
	if (typeof args.file_path === 'string' && args.file_path) {
		paths.push(args.file_path);
	}
	return paths;
}
