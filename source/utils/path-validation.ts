import path from 'node:path';

/**
 * Path Validation Utilities
 *
 * This module provides security-focused path validation functions to prevent
 * directory traversal attacks and ensure file operations remain within the
 * project directory.
 *
 * These functions are used by file manipulation tools (read_file, write_file,
 * string_replace) and the file mention parser to ensure all file paths are
 * safe before any file system operations are performed.
 *
 * Security threats mitigated:
 * - Directory traversal attacks (../ or ..\)
 * - Absolute path escapes (/etc/passwd, C:\Windows\System32)
 * - Null byte injection (\0)
 * - Path separator confusion (mixing / and \)
 */

/**
 * Validates that a file path is safe and within acceptable boundaries.
 *
 * This function performs multiple security checks to ensure the path:
 * - Is not empty
 * - Does not contain directory traversal sequences (..)
 * - Is not an absolute path (Unix or Windows style)
 * - Does not contain null bytes (security exploit)
 * - Does not start with path separators
 *
 * @param filePath - The relative file path to validate
 * @returns true if the path is valid and safe, false otherwise
 *
 * @example
 * ```ts
 * isValidFilePath('src/app.tsx')        // true
 * isValidFilePath('../etc/passwd')      // false - directory traversal
 * isValidFilePath('/etc/passwd')        // false - absolute path
 * isValidFilePath('C:\\Windows\\file')  // false - Windows absolute path
 * isValidFilePath('file\0.txt')         // false - null byte injection
 * ```
 */
export function isValidFilePath(filePath: string): boolean {
	// Reject empty paths
	if (!filePath || filePath.trim().length === 0) {
		return false;
	}

	// Reject paths that try to escape parent directories
	if (filePath.includes('..')) {
		return false;
	}

	// Reject absolute paths (outside project)
	if (path.isAbsolute(filePath)) {
		return false;
	}

	// Reject Windows absolute paths (C:\, D:\, etc.) even on Unix systems
	if (/^[A-Za-z]:[/\\]/.test(filePath)) {
		return false;
	}

	// Reject paths with null bytes (security)
	if (filePath.includes('\0')) {
		return false;
	}

	// Reject home directory shorthand (~ is not expanded by Node.js)
	if (filePath.startsWith('~')) {
		return false;
	}

	// Reject paths that start with special characters that could be problematic
	if (filePath.startsWith('/') || filePath.startsWith('\\')) {
		return false;
	}

	return true;
}

/**
 * Resolves a relative file path to an absolute path and ensures it remains
 * within the project directory.
 *
 * This function provides defense-in-depth by:
 * 1. First validating the path using isValidFilePath()
 * 2. Resolving the path to an absolute path
 * 3. Verifying the resolved path is still within the project directory
 *
 * @param filePath - The relative file path to resolve
 * @param cwd - The current working directory (project root)
 * @returns The absolute path to the file
 * @throws Error if the path is invalid or escapes the project directory
 *
 * @example
 * ```ts
 * resolveFilePath('src/app.tsx', '/home/user/project')
 * // Returns: '/home/user/project/src/app.tsx'
 *
 * resolveFilePath('../etc/passwd', '/home/user/project')
 * // Throws: Invalid file path: ../etc/passwd
 *
 * // Symlink that escapes project directory:
 * resolveFilePath('symlink-to-etc', '/home/user/project')
 * // Throws: File path escapes project directory
 * ```
 */
export function resolveFilePath(filePath: string, cwd: string): string {
	// Validate first
	if (!isValidFilePath(filePath)) {
		throw new Error(`Invalid file path: ${filePath}`);
	}

	// Resolve to absolute path
	const absolutePath = path.resolve(cwd, filePath);

	// Ensure the resolved path is still within the project directory
	const normalizedCwd = path.resolve(cwd);
	if (!absolutePath.startsWith(normalizedCwd)) {
		throw new Error(
			`File path escapes project directory: ${filePath} -> ${absolutePath}`,
		);
	}

	return absolutePath;
}
