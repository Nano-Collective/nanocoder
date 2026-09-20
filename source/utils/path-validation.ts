import {existsSync, realpathSync} from 'node:fs';
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
export function isValidFilePath(
	filePath: string,
	containmentRoot?: string,
): boolean {
	// Reject empty paths
	if (!filePath || filePath.trim().length === 0) {
		return false;
	}

	// Reject paths that try to escape parent directories
	// Check for '..' as a path segment, not substring (e.g. [[...slug]] is valid)
	const segments = filePath.split(/[/\\]/);
	if (segments.some(seg => seg === '..')) {
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

	// Windows-drive paths (`C:\`, `D:\`) are absolute only on Windows. On POSIX
	// `path.resolve` would fold them into the cwd and they'd masquerade as an
	// in-project relative path — reject them unless this platform actually treats
	// them as absolute (Windows, where the containment check below still applies).
	if (/^[A-Za-z]:[/\\]/.test(filePath) && !path.isAbsolute(filePath)) {
		return false;
	}

	// Absolute paths are accepted only when a containment root is known and they
	// resolve inside it — weak models routinely pass absolute paths.
	// resolveFilePath still runs the authoritative symlink check.
	if (path.isAbsolute(filePath)) {
		if (!containmentRoot) {
			return false;
		}
		const root = path.resolve(containmentRoot);
		const abs = path.resolve(filePath);
		return abs === root || abs.startsWith(root + path.sep);
	}

	// A relative path must not start with a separator
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
 * 3. Verifying the resolved path is lexically within the project directory
 * 4. Verifying it is *really* within the project after resolving symlinks, so
 *    an in-project symlink (or a symlinked path segment) cannot redirect the
 *    operation to a target outside the project (e.g. a `link` -> `~/.ssh`).
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
 * // In-project symlink whose real target is outside the project:
 * resolveFilePath('link-to-etc', '/home/user/project') // link-to-etc -> /etc
 * // Throws: File path escapes project directory via symlink
 * ```
 */
export function resolveFilePath(
	filePath: string,
	cwd: string,
	containmentRoot: string = cwd,
): string {
	// Relative paths resolve against `cwd` (the session cwd, which follows `cd`);
	// containment is checked against `containmentRoot` (the project root, which
	// does NOT shrink as `cd` descends). Defaulting the root to `cwd` keeps the
	// single-arg contract for callers that don't separate the two.
	if (!isValidFilePath(filePath, containmentRoot)) {
		throw new Error(`Invalid file path: ${filePath}`);
	}

	const normalizedCwd = path.resolve(cwd);
	const normalizedRoot = path.resolve(containmentRoot);
	const absolutePath = path.resolve(normalizedCwd, filePath);

	// Lexical containment. The trailing separator stops a sibling directory
	// with a shared prefix (e.g. `/proj-evil` for project `/proj`) from passing.
	if (
		absolutePath !== normalizedRoot &&
		!absolutePath.startsWith(normalizedRoot + path.sep)
	) {
		throw new Error(
			`File path escapes project directory: ${filePath} -> ${absolutePath}`,
		);
	}

	// Symlink-aware containment. `path.resolve` is purely lexical and never
	// follows symlinks, so the lexical check above can be defeated by an
	// in-project symlink pointing elsewhere. Resolve real paths (both sides,
	// since the project root itself may sit under a symlink such as
	// /tmp -> /private/tmp on macOS) and re-check.
	const realRoot = realResolvedPrefix(normalizedRoot);
	const realTarget = realResolvedPrefix(absolutePath);
	if (realTarget !== realRoot && !realTarget.startsWith(realRoot + path.sep)) {
		throw new Error(
			`File path escapes project directory via symlink: ${filePath} -> ${realTarget}`,
		);
	}

	return absolutePath;
}

/**
 * Resolve symlinks for the portion of `target` that exists on disk, then
 * re-append any not-yet-created trailing segments. This lets us symlink-check
 * paths for files that don't exist yet (e.g. a new file passed to write_file)
 * while still resolving any symlinked ancestor directories. Non-existent
 * segments cannot themselves be symlinks, so appending them lexically is safe.
 */
function realResolvedPrefix(target: string): string {
	let existing = target;
	const tail: string[] = [];
	while (!existsSync(existing)) {
		const parent = path.dirname(existing);
		if (parent === existing) break; // reached the filesystem root
		tail.unshift(path.basename(existing));
		existing = parent;
	}
	let real: string;
	try {
		real = realpathSync(existing);
	} catch {
		// Fail safe: if we can't resolve, fall back to the lexical path so the
		// caller's lexical containment check remains authoritative.
		real = existing;
	}
	return tail.length > 0 ? path.join(real, ...tail) : real;
}
