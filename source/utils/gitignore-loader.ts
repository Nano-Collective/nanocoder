import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import ignore from 'ignore';

/**
 * Default directories to always ignore during file operations.
 * These are commonly large or irrelevant directories.
 */
const DEFAULT_IGNORE_DIRS = [
	'node_modules',
	'.git',
	'dist',
	'build',
	'coverage',
	'.next',
	'.nuxt',
	'out',
	'.cache',
];

/**
 * Load and parse .gitignore file, returns an ignore instance.
 * Always includes default ignore patterns for common directories.
 *
 * @param cwd - The current working directory to load .gitignore from
 * @returns An ignore instance configured with patterns
 */
export function loadGitignore(cwd: string): ReturnType<typeof ignore> {
	const ig = ignore();
	const gitignorePath = join(cwd, '.gitignore');

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

	return ig;
}

/**
 * Export default ignore directories for use in other contexts
 * (e.g., building command-line arguments for grep/find)
 */
export {DEFAULT_IGNORE_DIRS};
