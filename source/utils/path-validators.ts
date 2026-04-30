import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

type ValidationResult = {valid: true} | {valid: false; error: string};

/**
 * Validates a single file path: checks format and project boundary.
 */
export function validatePath(path: string): ValidationResult {
	if (!isValidFilePath(path)) {
		return {
			valid: false,
			error: `⚒ Invalid file path. Path must be relative and within the project directory.`,
		};
	}

	try {
		const cwd = process.cwd();
		resolveFilePath(path, cwd);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
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
	if (!isValidFilePath(source)) {
		return {
			valid: false,
			error: `⚒ Invalid source path. Path must be relative and within the project directory.`,
		};
	}

	if (!isValidFilePath(destination)) {
		return {
			valid: false,
			error: `⚒ Invalid destination path. Path must be relative and within the project directory.`,
		};
	}

	try {
		const cwd = process.cwd();
		resolveFilePath(source, cwd);
		resolveFilePath(destination, cwd);
	} catch (error) {
		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		return {
			valid: false,
			error: `⚒ Path validation failed: ${errorMessage}`,
		};
	}

	return {valid: true};
}
