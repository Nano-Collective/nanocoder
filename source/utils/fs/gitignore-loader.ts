import {existsSync, readFileSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
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

const NANOCODER_IGNORE_FILENAME = '.nanocoderignore';

/**
 * Absolute path to the workspace's .nanocoderignore, or undefined when there
 * isn't one.
 *
 * Exists so callers that hand the file to an external tool - ripgrep's
 * `--ignore-file`, say - resolve it the same way {@link loadGitignore} does
 * rather than re-deriving the filename.
 */
export function findNanocoderIgnoreFile(
	workspaceRoot: string,
): string | undefined {
	const candidate = join(workspaceRoot, NANOCODER_IGNORE_FILENAME);
	return existsSync(candidate) ? candidate : undefined;
}

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
	const nanocoderignorePath = join(workspaceRoot, NANOCODER_IGNORE_FILENAME);

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
 * Rewrite one line of a nested .gitignore so it can be added to an ignore
 * instance that matches project-root-relative paths.
 *
 * Git scopes a nested .gitignore to its own directory. An unanchored `foo`
 * matches at any depth below that directory; a pattern with a leading or
 * inner slash stays relative to it (`dirPrefix/foo`).
 *
 * @param line - A line of the .gitignore
 * @param dirPrefix - The directory holding the file, root-relative, with
 * forward slashes; empty for the project root
 * @returns The rewritten pattern, or undefined for a blank line or a comment
 */
export function prefixGitignoreLine(
	line: string,
	dirPrefix: string,
): string | undefined {
	const trimmed = line.trimEnd();
	if (!trimmed || trimmed.startsWith('#')) {
		return undefined;
	}
	if (!dirPrefix) {
		return trimmed;
	}

	const negated = trimmed.startsWith('!');
	const pattern = negated ? trimmed.slice(1) : trimmed;
	const isAnchoredOrNested =
		pattern.startsWith('/') || pattern.replace(/\/$/, '').includes('/');
	const prefixed = isAnchoredOrNested
		? `${dirPrefix}/${pattern.replace(/^\//, '')}`
		: `${dirPrefix}/**/${pattern}`;
	return negated ? `!${prefixed}` : prefixed;
}

/**
 * Add the .gitignore of one directory below the project root to an ignore
 * instance, scoped to that directory the way git scopes it.
 *
 * Walkers call this on entering a directory so that a nested .gitignore hides
 * the same files from every tool. Patterns are added after the ones already
 * in `ig`, so they take precedence over the project root's, as in git. A
 * missing or unreadable file is skipped.
 *
 * The project root's own .gitignore is loaded by {@link loadGitignore}; pass
 * a non-empty `dirPrefix` only, or it would be added twice.
 *
 * @param ig - The ignore instance to extend
 * @param absoluteDir - Absolute path of the directory to read
 * @param dirPrefix - The same directory, root-relative, with forward slashes
 */
export async function addNestedGitignore(
	ig: ReturnType<typeof ignore>,
	absoluteDir: string,
	dirPrefix: string,
): Promise<void> {
	if (dirPrefix === '') {
		return;
	}
	const content = await readFile(
		join(absoluteDir, '.gitignore'),
		'utf-8',
	).catch(() => undefined);
	if (content === undefined) {
		return;
	}
	const patterns = content
		.split('\n')
		.map(line => prefixGitignoreLine(line, dirPrefix))
		.filter((line): line is string => line !== undefined);
	if (patterns.length > 0) {
		ig.add(patterns);
	}
}

/**
 * Export default ignore directories for use in other contexts
 * (e.g., building command-line arguments for grep/find)
 */
export {DEFAULT_IGNORE_DIRS};
