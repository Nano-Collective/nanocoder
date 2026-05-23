import {promises as fs} from 'node:fs';
import {join} from 'node:path';

/**
 * Shallow walk of a directory for `.md` files, with per-file parsing.
 *
 * Extracts the shape repeated across `CustomCommandLoader.scanDirectory`,
 * `SubagentLoader.loadFromDirectory`, and `CustomToolLoader.scanDirectory`:
 * existence check, read dir, filter to `.md`, stat, parse, capture errors.
 *
 * The walk is intentionally non-recursive. Callers that need recursion or
 * namespacing (e.g. the custom-commands loader) handle that themselves and
 * call this helper for each leaf directory. The bundle loader uses it once
 * per `commands/` / `agents/` / `tools/` subdir inside a skill bundle.
 *
 * A missing directory returns an empty result with no error. Any other
 * failure to read the directory is reported as a single error against the
 * directory path; per-file parse failures are reported individually.
 */

export interface ParsedMdFile<T> {
	filePath: string;
	parsed: T;
}

export interface MdLoadError {
	filePath: string;
	error: string;
}

export interface MdLoadResult<T> {
	entries: ParsedMdFile<T>[];
	errors: MdLoadError[];
}

export type MdFileParser<T> = (filePath: string) => T | Promise<T>;

/**
 * Reject `.` / `..` and any entry containing a path separator. Mirrors the
 * defensive check duplicated in the existing custom-tools and
 * custom-commands loaders.
 */
function isSafeEntry(entry: string): boolean {
	return (
		entry !== '..' &&
		entry !== '.' &&
		!entry.includes('/') &&
		!entry.includes('\\')
	);
}

function errorMessage(err: unknown): string {
	return err instanceof Error ? err.message : String(err);
}

export async function loadMdDir<T>(
	dir: string,
	parse: MdFileParser<T>,
): Promise<MdLoadResult<T>> {
	const result: MdLoadResult<T> = {entries: [], errors: []};

	let entries: string[];
	try {
		entries = await fs.readdir(dir);
	} catch (err) {
		const code = (err as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return result;
		result.errors.push({filePath: dir, error: errorMessage(err)});
		return result;
	}

	for (const entry of entries) {
		if (!isSafeEntry(entry)) continue;
		if (!entry.endsWith('.md')) continue;
		const filePath = join(dir, entry);

		try {
			const stat = await fs.stat(filePath);
			if (!stat.isFile()) continue;
		} catch {
			continue;
		}

		try {
			const parsed = await parse(filePath);
			result.entries.push({filePath, parsed});
		} catch (err) {
			result.errors.push({filePath, error: errorMessage(err)});
		}
	}

	return result;
}
