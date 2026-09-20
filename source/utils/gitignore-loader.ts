import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import ignore from 'ignore';

/**
 * Default directories to always ignore during file operations.
 * These are commonly large or irrelevant directories.
 * Organized by ecosystem/purpose for maintainability.
 */
const DEFAULT_IGNORE_DIRS = [
	// JavaScript/TypeScript/Node.js
	'node_modules',
	'.cache',

	// Build outputs
	'dist',
	'build',
	'out',

	// Framework-specific build outputs
	'.next', // Next.js
	'.nuxt', // Nuxt.js

	// Python
	'__pycache__',
	'.pytest_cache',

	// Rust/Java
	'target',

	// Test coverage
	'coverage',

	// Version control systems
	'.git',
	'.svn', // Subversion
	'.hg', // Mercurial
];

export interface LoadGitignoreOptions {
	/**
	 * Whether to layer .nanocoderignore on top of .gitignore. Defaults to true.
	 *
	 * Set this to false for consumers where "ignored" means something other than
	 * "keep out of the model's view" - checkpoint snapshots, for example, still
	 * need to cover a file the user hid from listings, or restoring a checkpoint
	 * would silently leave that file's changes in place.
	 */
	nanocoderIgnore?: boolean;
}

/**
 * Load and parse .gitignore and .nanocoderignore files, returns an ignore instance.
 * Always includes default ignore patterns for common directories.
 *
 * .nanocoderignore is an additional, nanocoder-specific ignore file. It keeps
 * files out of directory listings, searches and the file explorer (saving tokens
 * and avoiding context bloat) even when those files are tracked in git and
 * therefore not covered by .gitignore, e.g. package-lock.json or large fixtures.
 *
 * It is not a secrets boundary: read_file and execute_bash do not consult these
 * patterns, so a listed file is still readable by path.
 *
 * Patterns are applied after .gitignore and the default ignores, so a
 * .nanocoderignore entry can also un-ignore something with a leading `!` - the
 * only way to opt back into a DEFAULT_IGNORE_DIRS entry such as `dist`.
 *
 * @param workspaceRoot - The workspace root to load .gitignore / .nanocoderignore from
 * @param options - See {@link LoadGitignoreOptions}
 * @returns An ignore instance configured with patterns
 */
export function loadGitignore(
	workspaceRoot: string,
	options: LoadGitignoreOptions = {},
): ReturnType<typeof ignore> {
	const {nanocoderIgnore = true} = options;
	const ig = ignore();
	const gitignorePath = join(workspaceRoot, '.gitignore');
	const nanocoderignorePath = join(workspaceRoot, '.nanocoderignore');

	// Always ignore common directories
	ig.add(DEFAULT_IGNORE_DIRS);

	// Load .gitignore if it exists
	if (existsSync(gitignorePath)) {
		try {
			const gitignoreContent = readFileSync(gitignorePath, 'utf-8');
			ig.add(gitignoreContent);
		} catch {
			// Silently fail if we can't read .gitignore
			// The hardcoded ignores above will still apply
		}
	}

	// Load .nanocoderignore if it exists. Added last so its patterns layer on top
	// of .gitignore and the defaults, including `!` negations of either.
	if (nanocoderIgnore && existsSync(nanocoderignorePath)) {
		try {
			const nanocoderignoreContent = readFileSync(nanocoderignorePath, 'utf-8');
			ig.add(nanocoderignoreContent);
		} catch {
			// Silently fail if we can't read .nanocoderignore
			// The gitignore + hardcoded ignores above will still apply
		}
	}

	return ig;
}

/**
 * Export default ignore directories for use in other contexts
 * (e.g., building command-line arguments for grep/find)
 */
export {DEFAULT_IGNORE_DIRS};
