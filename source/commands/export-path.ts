import path from 'path';

/**
 * `resolveFilePath` throws a single generic "Invalid file path" for several
 * distinct causes, which leaves the user guessing (a null byte and a `~` are
 * very different mistakes). Re-derive the specific reason so the message names
 * what was actually wrong and how to fix it.
 *
 * Files written by `/export` and `/share` are deliberately contained to the
 * project directory, the same as `read_file` / `write_file` /
 * `string_replace`. `~` is not expanded and paths outside the root are refused
 * rather than silently redirected.
 */
export function explainInvalidExportPath(
	filename: string,
	root: string,
): string {
	if (!filename.trim()) {
		return 'the filename is empty';
	}
	if (filename.includes('\0')) {
		return 'the filename contains a null byte';
	}
	if (filename.startsWith('~')) {
		return "'~' is not expanded; use a path relative to the project, or an absolute path inside it";
	}
	if (filename.split(/[/\\]/).some(segment => segment === '..')) {
		return "'..' segments are not allowed; exports stay inside the project";
	}
	return `it is outside the project directory (${root})`;
}

/**
 * Show a written file relative to the project root so subdirectory exports
 * (e.g. reports/chat.md) are recognisable rather than a bare basename.
 */
export function toProjectDisplayPath(
	filepath: string,
	projectRoot: string,
): string {
	return filepath.startsWith(projectRoot + path.sep)
		? filepath.slice(projectRoot.length + 1)
		: filepath;
}
