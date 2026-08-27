import {getProjectRoot, getSessionCwd} from '@/services/session-cwd';
import {formatError} from '@/utils/error-formatter';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

type ValidationResult = {valid: true} | {valid: false; error: string};

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

	try {
		resolveFilePath(path, cwd, root);
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
 * Validates a source + destination path pair: checks format and project boundary for both.
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

	try {
		resolveFilePath(source, cwd, root);
		resolveFilePath(destination, cwd, root);
	} catch (error) {
		const errorMessage = formatError(error);
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	return {valid: true};
}
