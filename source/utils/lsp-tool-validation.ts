/**
 * LSP Tool Validation Utilities
 *
 * Shared validation functions for LSP-based tools to reduce code duplication.
 */

import {constants} from 'node:fs';
import {access} from 'node:fs/promises';
import {resolve as resolvePath} from 'node:path';

export interface PositionArgs {
	path: string;
	line: number;
	character: number;
}

/**
 * Validates common position-based arguments (path, line, character).
 * Used by find-references, go-to-definition, and rename-symbol tools.
 *
 * @param args - Tool arguments containing path, line, and character
 * @returns Validation result with error message if invalid
 */
export async function validatePositionArgs(
	args: PositionArgs,
): Promise<{valid: true} | {valid: false; error: string}> {
	const absPath = resolvePath(args.path);

	try {
		await access(absPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ File not found: "${args.path}"`,
		};
	}

	if (args.line < 1) {
		return {valid: false, error: '⚒ Line must be >= 1'};
	}

	if (args.character < 1) {
		return {valid: false, error: '⚒ Character must be >= 1'};
	}

	return {valid: true};
}

/**
 * Validates path-only arguments.
 * Used by document-symbols tool.
 *
 * @param path - File path to validate
 * @returns Validation result with error message if invalid
 */
export async function validatePathOnly(
	path: string,
): Promise<{valid: true} | {valid: false; error: string}> {
	const absPath = resolvePath(path);

	try {
		await access(absPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ File not found: "${path}"`,
		};
	}

	return {valid: true};
}
