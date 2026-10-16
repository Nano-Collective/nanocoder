import {extname} from 'node:path';
import {getProjectRoot, getSessionCwd} from '@/services/session-cwd';
import {isDerivedContentPath} from '@/utils/derived-content';
import {formatError} from '@/utils/error-formatter';
import {
	checkRestrictedScope,
	isValidFilePath,
	resolveFilePath,
} from '@/utils/path-validation';

type ValidationResult = {valid: true} | {valid: false; error: string};

/**
 * Validates a single file path: checks format and project boundary.
 */
export function validatePath(
	path: string,
	options?: {restrictedScope?: string | string[]},
): ValidationResult {
	const cwd = getSessionCwd();
	const root = getProjectRoot();
	if (!isValidFilePath(path, root)) {
		return {
			valid: false,
			error: `⚒ Invalid file path. Path must be within the project directory.`,
		};
	}

	try {
		const absolutePath = resolveFilePath(path, cwd, root);
		if (options?.restrictedScope) {
			const scopes = Array.isArray(options.restrictedScope)
				? options.restrictedScope
				: [options.restrictedScope];
			const absoluteScopes = scopes.map(s => resolveFilePath(s, cwd, root));
			checkRestrictedScope(absolutePath, absoluteScopes);
		}
	} catch (error) {
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
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
 * Validates a source + destination path pair: checks format and project boundary for both.
 */
export function validatePathPair(
	source: string,
	destination: string,
	options?: {restrictedScope?: string | string[]},
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

	try {
		const absSource = resolveFilePath(source, cwd, root);
		const absDest = resolveFilePath(destination, cwd, root);

		if (options?.restrictedScope) {
			const scopes = Array.isArray(options.restrictedScope)
				? options.restrictedScope
				: [options.restrictedScope];
			const absoluteScopes = scopes.map(s => resolveFilePath(s, cwd, root));
			checkRestrictedScope(absSource, absoluteScopes);
			checkRestrictedScope(absDest, absoluteScopes);
		}
	} catch (error) {
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	return {valid: true};
}
