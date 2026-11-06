import path, {extname} from 'node:path';
import {getProjectRoot, getSessionCwd} from '@/services/session-cwd';
import {isDerivedContentPath} from '@/utils/derived-content';
import {formatError} from '@/utils/error-formatter';
import type {CachedFile} from '@/utils/file-cache';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

type ValidationResult = {valid: true} | {valid: false; error: string};

/**
 * Directories no file mutation may touch. Containment normally rejects them as
 * "outside the project", but when the project root is itself a filesystem root
 * (`/`, or a drive root in a container — see #1240) every absolute path is
 * contained, so the boundary alone cannot protect these. The check used to live
 * only in write_file; keeping it here covers every mutating file tool
 * (write_file, string_replace, diff_edit, file_op). See #1941.
 */
const SYSTEM_DIRECTORIES =
	process.platform === 'win32'
		? ['C:\\Windows', 'C:\\Program Files']
		: ['/etc', '/sys', '/proc', '/dev', '/boot'];

/**
 * True when the resolved path is a system directory or sits inside one. Takes
 * the absolute path, not the raw argument, so a relative path that resolves
 * into a system directory under a root-mounted project is caught too.
 */
function isInSystemDirectory(absPath: string): boolean {
	// Windows paths compare case-insensitively; POSIX paths do not.
	const fold = (value: string) =>
		process.platform === 'win32' ? value.toLowerCase() : value;
	const target = fold(path.resolve(absPath));
	return SYSTEM_DIRECTORIES.some(directory => {
		const guarded = fold(path.resolve(directory));
		// The separator stops a sibling with a shared prefix (`/etcetera` for `/etc`).
		return target === guarded || target.startsWith(guarded + path.sep);
	});
}

/**
 * Validates a single file path: checks format and project boundary.
 */
export function validatePath(path: string): ValidationResult {
	const cwd = getSessionCwd();
	const root = getProjectRoot();
	if (!isValidFilePath(path, root)) {
		return {
			valid: false,
			error: `⚒ Invalid file path. Path must be within the project directory.`,
		};
	}

	let resolved: string;
	try {
		resolved = resolveFilePath(path, cwd, root);
	} catch (error) {
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	if (isInSystemDirectory(resolved)) {
		return {
			valid: false,
			error: `⚒ Cannot write files to system directory: "${path}"`,
		};
	}

	return {valid: true};
}

/**
 * Rejects paths the read path can only transcribe, not reproduce: a PDF or DOCX
 * is read back as markdown, so an edit written over the original path would
 * replace the document with that transcript and destroy it. The check is on the
 * extension rather than on cached content so it also covers a fresh write to a
 * path that has never been read.
 */
export function validateEditableFormat(path: string): ValidationResult {
	if (!isDerivedContentPath(path)) return {valid: true};

	return {
		valid: false,
		error: `⚒ Cannot write to "${path}": reading a ${extname(path).toLowerCase()} file returns a markdown transcript, not the document itself, so writing an edit back would replace the document with that transcript. Do not retry — edit the document with a tool that understands its format, or save the new text to a separate file.`,
	};
}

/**
 * Rejects a file whose bytes are not valid UTF-8, such as Latin-1, Windows-1252
 * or Shift-JIS. The edit tools work on the file decoded as UTF-8 and write the
 * whole file back as UTF-8, so every byte that didn't decode would be written
 * back as U+FFFD, on lines the edit never touched as well.
 */
export function validateEditableEncoding(
	path: string,
	file: Pick<CachedFile, 'notUtf8'>,
): ValidationResult {
	if (!file.notUtf8) return {valid: true};

	return {
		valid: false,
		error: `⚒ Cannot edit "${path}": it is not valid UTF-8, so it probably uses a legacy encoding such as Latin-1, Windows-1252 or Shift-JIS. The edit would be written back as UTF-8, which would replace every byte that isn't valid UTF-8 with U+FFFD (�), including on lines the edit doesn't touch. Do not retry — tell the user, who can convert the file to UTF-8 first (for example with iconv) or make the change in an editor that keeps the file's encoding.`,
	};
}

/**
 * Validates a source + destination path pair (copy/move): checks format and
 * project boundary for both. The system-directory write guard applies only to
 * the destination — the source is read, not written, so copying from a system
 * directory is not blocked by this guard (containment still applies).
 */
export function validatePathPair(
	source: string,
	destination: string,
): ValidationResult {
	const cwd = getSessionCwd();
	const root = getProjectRoot();
	if (!isValidFilePath(source, root)) {
		return {
			valid: false,
			error: `⚒ Invalid source path. Path must be within the project directory.`,
		};
	}

	if (!isValidFilePath(destination, root)) {
		return {
			valid: false,
			error: `⚒ Invalid destination path. Path must be within the project directory.`,
		};
	}

	let resolvedDestination: string;
	try {
		resolveFilePath(source, cwd, root);
		resolvedDestination = resolveFilePath(destination, cwd, root);
	} catch (error) {
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	if (isInSystemDirectory(resolvedDestination)) {
		return {
			valid: false,
			error: `⚒ Cannot write files to system directory: "${destination}"`,
		};
	}

	return {valid: true};
}
