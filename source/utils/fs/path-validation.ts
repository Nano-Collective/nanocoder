import {lstatSync, readlinkSync, realpathSync} from 'node:fs';
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
 * - Is not an absolute path (Unix or Windows style), unless it is inside
 *   `containmentRoot`. That check resolves real paths, so absolute paths
 *   touch the filesystem. Relative paths stay a pure string check.
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
	// resolve inside it — weak models routinely pass absolute paths. The real
	// path counts too: a root opened through a symlink (or /tmp vs /private/tmp
	// on macOS) has two spellings. resolveFilePath still runs the authoritative
	// symlink check.
	if (path.isAbsolute(filePath)) {
		if (!containmentRoot) {
			return false;
		}
		const root = path.resolve(containmentRoot);
		const abs = path.resolve(filePath);
		if (isPathInside(abs, root)) {
			return true;
		}
		try {
			return isPathInside(realResolvedPrefix(abs), realResolvedPrefix(root));
		} catch {
			return false; // symlink loop
		}
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

	// Symlink-aware containment. `path.resolve` is purely lexical and never
	// follows symlinks, so a lexical check alone can be defeated by an
	// in-project symlink pointing elsewhere. Resolve real paths (both sides,
	// since the project root itself may sit under a symlink such as
	// /tmp -> /private/tmp on macOS). The real-path check is authoritative:
	// the other spelling of the root is the same directory and must pass.
	// A symlink loop throws here, which rejects the path.
	const realRoot = realResolvedPrefix(normalizedRoot);
	const realTarget = realResolvedPrefix(absolutePath);

	// Lexical containment only picks the clearer message. The trailing
	// separator stops a sibling with a shared prefix (`/proj-evil` for `/proj`).
	if (
		!isPathInside(absolutePath, normalizedRoot) &&
		!isPathInside(realTarget, realRoot)
	) {
		throw new Error(
			`File path escapes project directory: ${filePath} -> ${absolutePath}`,
		);
	}

	if (!isPathInside(realTarget, realRoot)) {
		throw new Error(
			`File path escapes project directory via symlink: ${filePath} -> ${realTarget}`,
		);
	}

	return absolutePath;
}

/**
 * Lexical containment: is `target` the root itself, or somewhere beneath it?
 *
 * Both arguments are resolved first, so callers may pass relative paths. The
 * trailing separator is what stops a sibling directory with a shared prefix
 * (e.g. `/proj-evil` for project `/proj`) from passing. Filesystem roots
 * (`/`, `C:\`) already end with a separator — appending another would yield
 * `//` or `C:\\`, which no real path starts with, so containment would always
 * fail when the workspace root is a drive or `/` (containers, root-owned
 * checkouts). See #1240.
 *
 * This is purely lexical — it never touches the filesystem, so a symlink
 * inside the root can still point outside it. Use `isRealPathInside` when the
 * path may be attacker- or config-controlled.
 */
export function isPathInside(target: string, root: string): boolean {
	const normalizedRoot = path.resolve(root);
	const normalizedTarget = path.resolve(target);
	if (normalizedTarget === normalizedRoot) {
		return true;
	}
	const prefix = normalizedRoot.endsWith(path.sep)
		? normalizedRoot
		: normalizedRoot + path.sep;
	return normalizedTarget.startsWith(prefix);
}

/**
 * Symlink-aware containment: is `target` really inside `root` once every
 * symlink on both sides is resolved?
 *
 * Both sides are realpath'd, because the root itself may sit under a symlink
 * (`/tmp` -> `/private/tmp` on macOS). That resolution is authoritative, so
 * there is deliberately no lexical pre-check: an absolute path that is
 * lexically outside the root but physically inside it (the same `/tmp` case,
 * reached from the other direction) is legitimately contained and must pass.
 *
 * Fails closed: if either side cannot be realpath'd (missing, unreadable, or a
 * symlink loop) this returns false. Callers using this as a security boundary
 * want the deny. `resolveFilePath` does NOT use this, because it must also
 * accept files that don't exist yet — see `realResolvedPrefix`.
 *
 * @example
 * ```ts
 * isRealPathInside('/proj/scripts', '/proj')   // true
 * isRealPathInside('/proj-evil', '/proj')      // false - shared prefix
 * isRealPathInside('/proj/link', '/proj')      // false - link -> /etc
 * ```
 */
export function isRealPathInside(target: string, root: string): boolean {
	try {
		return isPathInside(realpathSync(target), realpathSync(root));
	} catch {
		return false;
	}
}

/**
 * Resolve symlinks for the portion of `target` that exists on disk, then
 * re-append any not-yet-created trailing segments. This lets us symlink-check
 * paths for files that don't exist yet (e.g. a new file passed to write_file)
 * while still resolving any symlinked ancestor directories.
 *
 * The path is walked one component at a time with `lstat`, following each
 * symlink by hand the way the kernel does, including links whose target does
 * not exist yet. An earlier version found the existing prefix with
 * `existsSync`, which follows symlinks: a dangling link (`notes.md ->
 * ~/.ssh/authorized_keys`) read as "not on disk", its name was re-appended
 * lexically, containment passed, and a write through it landed outside the
 * project. `..` in a link target is applied to the real directory reached so
 * far, not folded lexically, because `a/..` means the parent of where `a`
 * really points.
 *
 * Once a component does not exist, nothing below it can be a symlink, so the
 * rest is appended lexically. Throws on a symlink loop: there is no real path,
 * and falling back to the lexical one would let containment pass.
 */
function realResolvedPrefix(target: string): string {
	const absolute = path.resolve(target);
	const {root} = path.parse(absolute);
	const pending = splitSegments(absolute.slice(root.length));
	let real = root;
	let hops = 0;
	while (pending.length > 0) {
		const segment = pending.shift() as string;
		if (segment === '' || segment === '.') continue;
		if (segment === '..') {
			real = path.dirname(real);
			continue;
		}
		const next = path.join(real, segment);
		let isLink: boolean;
		try {
			isLink = lstatSync(next).isSymbolicLink();
		} catch {
			// Missing (or not inspectable): fail safe to the lexical remainder so
			// the caller's lexical containment check stays authoritative.
			return path.join(next, ...pending);
		}
		if (!isLink) {
			real = next;
			continue;
		}
		hops += 1;
		if (hops > MAX_SYMLINK_HOPS) {
			throw new Error(`Too many levels of symbolic links: ${target}`);
		}
		const linkTarget = readlinkSync(next);
		if (path.isAbsolute(linkTarget)) {
			const linkRoot = path.parse(linkTarget).root;
			real = linkRoot;
			pending.unshift(...splitSegments(linkTarget.slice(linkRoot.length)));
		} else {
			// Relative targets resolve against the link's own directory: `real`.
			pending.unshift(...splitSegments(linkTarget));
		}
	}
	return real;
}

// Matches Linux's MAXSYMLINKS.
const MAX_SYMLINK_HOPS = 40;

function splitSegments(p: string): string[] {
	return p.split(path.sep === '\\' ? /[\\/]/ : '/');
}
