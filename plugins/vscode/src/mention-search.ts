/**
 * Workspace search behind the composer's `@` autocomplete.
 *
 * This module deliberately imports nothing from `vscode` so it can be unit
 * tested outside the extension host — the caller injects the two workspace
 * APIs it needs (see `mention-search.spec.ts`). `chat-webview-provider.ts`
 * supplies the real `vscode.workspace.findFiles` / `vscode.window.tabGroups`
 * implementations, and owns the exclude glob so this file never has to know
 * about user settings.
 */

import { MentionItem } from './webview-protocol';

export type MentionKind = MentionItem['kind'];

export interface MentionSearchDeps {
	/** Absolute path of the workspace root. */
	workspaceRoot: string;
	/** Absolute paths of files currently open in editor tabs. */
	openEditors(): string[];
	/** Absolute paths matching a VS Code glob, capped at `limit`. */
	findFiles(glob: string, limit: number): Promise<string[]>;
	/**
	 * Whether the host filesystem treats `Foo.ts` and `foo.ts` as one file.
	 * Only used to key the dedupe map: folding case unconditionally would drop
	 * one of two genuinely distinct siblings on Linux.
	 */
	caseInsensitiveFs?: boolean;
}

/** Raw matches requested from VS Code before ranking and truncation. */
const SEARCH_LIMIT = 200;

/** Suggestions returned to the webview. */
export const MENTION_RESULT_LIMIT = 30;

/** Longest query we will search for; anything longer is a paste, not a mention. */
const MAX_QUERY_LENGTH = 120;

/** Glob metacharacters a user can type into a mention. */
const GLOB_METACHARS = /[*?[\]{}()!+@]/g;

export const DEFAULT_CASE_INSENSITIVE_FS =
	process.platform === 'win32' || process.platform === 'darwin';

function toPosix(p: string): string {
	return p.replace(/\\/g, '/');
}

/**
 * Path helpers are hand-rolled against the posix form rather than delegating to
 * node's `path`. `path` binds to the *host* separator, so a Windows path is
 * one opaque segment when these run on Linux — which would make every
 * separator-handling test pass locally and silently mean nothing in CI.
 */
function basename(p: string): string {
	const trimmed = toPosix(p).replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function dirname(p: string): string {
	const trimmed = toPosix(p).replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx <= 0 ? '' : trimmed.slice(0, idx);
}

/**
 * Workspace-relative path with forward slashes. Falls back to the absolute
 * path when the file lives outside the workspace (e.g. an open editor pointing
 * somewhere else on disk), so such entries are still usable — just not pretty.
 */
export function toRelPath(absPath: string, workspaceRoot: string): string {
	const abs = toPosix(absPath);
	const root = toPosix(workspaceRoot).replace(/\/+$/, '');
	if (!root) {
		return abs;
	}
	const prefix = root + '/';
	// Case-insensitive so Windows drive-letter casing does not defeat the match.
	if (abs.toLowerCase().startsWith(prefix.toLowerCase())) {
		return abs.slice(prefix.length);
	}
	return abs;
}

/**
 * Rewrite a user query into something safe to interpolate into a glob.
 *
 * Glob metacharacters typed by the user would otherwise either explode into a
 * far broader search (`{`, `[`) or fail to parse. Widening each one to `*`
 * keeps the search a superset of what the user meant; `matchesQuery` then
 * narrows the results back down.
 */
export function toGlobFragment(query: string): string {
	return query.replace(GLOB_METACHARS, '*').replace(/\*+/g, '*');
}

/**
 * The query with glob metacharacters removed — what results are actually
 * filtered against.
 *
 * Matching on the raw query would make any metacharacter unsatisfiable: no
 * path contains a literal `**`, so `@**` widened the glob to a full workspace
 * scan and then discarded every result it found.
 */
export function toLiteralQuery(normalizedQuery: string): string {
	return normalizedQuery.replace(GLOB_METACHARS, '');
}

/** Lowercased, forward-slashed form used for all matching and ranking. */
export function normalizeQuery(query: string): string {
	return toPosix(query).toLowerCase();
}

/** Trailing path segment — the only part a filename glob can match. */
export function lastSegment(normalizedQuery: string): string {
	const idx = normalizedQuery.lastIndexOf('/');
	return idx === -1 ? normalizedQuery : normalizedQuery.slice(idx + 1);
}

/**
 * A query containing `/` is a path fragment and must match the relative path;
 * a bare query only has to match the basename. Without this split, typing
 * `src/` would match every file whose *name* happened to contain "src".
 */
export function matchesQuery(item: MentionItem, literalQuery: string): boolean {
	if (!literalQuery) {
		return true;
	}
	if (literalQuery.includes('/')) {
		return item.relPath.toLowerCase().includes(literalQuery);
	}
	return item.name.toLowerCase().includes(literalQuery);
}

export function scoreItem(item: MentionItem, literalQuery: string): number {
	const name = item.name.toLowerCase();
	const rel = item.relPath.toLowerCase();

	let score: number;
	if (!literalQuery) {
		score = 0;
	} else if (name === literalQuery) {
		score = 100;
	} else if (name.startsWith(literalQuery)) {
		score = 80;
	} else if (name.includes(literalQuery)) {
		score = 60;
	} else if (rel.endsWith(literalQuery)) {
		score = 50;
	} else if (rel.includes(literalQuery)) {
		score = 40;
	} else {
		score = 0;
	}

	// Open editors are what the user is most likely to mean.
	if (item.isEditor) {
		score += 25;
	} else if (item.kind === 'folder') {
		score += 5;
	}
	return score;
}

/**
 * Score first, then shallower paths, then alphabetical. The last two keys make
 * the order fully deterministic, which is what lets the tests assert on it.
 */
function compareItems(a: MentionItem, b: MentionItem, literalQuery: string): number {
	const scoreDelta = scoreItem(b, literalQuery) - scoreItem(a, literalQuery);
	if (scoreDelta !== 0) {
		return scoreDelta;
	}
	const lengthDelta = a.relPath.length - b.relPath.length;
	if (lengthDelta !== 0) {
		return lengthDelta;
	}
	return a.relPath.localeCompare(b.relPath);
}

function makeItem(
	absPath: string,
	workspaceRoot: string,
	kind: MentionKind,
	isEditor: boolean,
): MentionItem {
	const relPath = toRelPath(absPath, workspaceRoot);
	return {
		path: absPath,
		name: basename(absPath) || relPath,
		relPath,
		kind,
		isEditor,
	};
}

/**
 * Directories between `absPath` and the workspace root whose own name matches
 * the query. This is how folders get discovered at all: a filename glob never
 * matches a directory like `src/components/` itself, only files named
 * "components".
 */
function matchingAncestors(
	absPath: string,
	workspaceRoot: string,
	segment: string,
): string[] {
	const root = toPosix(workspaceRoot).replace(/\/+$/, '').toLowerCase();
	const found: string[] = [];
	let dir = dirname(absPath);

	// Stops at the workspace root: `dir` only ever shortens, so the length
	// check terminates the walk even for a path outside the root entirely.
	while (dir && dir.toLowerCase() !== root && dir.length > root.length) {
		if (basename(dir).toLowerCase().includes(segment)) {
			found.push(dir);
		}
		const parent = dirname(dir);
		if (parent === dir) {
			break;
		}
		dir = parent;
	}
	return found;
}

/**
 * Resolve an `@` query into ranked suggestions.
 *
 * Open editors are matched with zero I/O, so a bare `@` returns instantly
 * without touching the filesystem — that responsiveness is most of what makes
 * the autocomplete feel native.
 */
export async function searchMentions(
	query: string,
	deps: MentionSearchDeps,
	limit: number = MENTION_RESULT_LIMIT,
): Promise<MentionItem[]> {
	if (query.length > MAX_QUERY_LENGTH) {
		return [];
	}

	const normalized = normalizeQuery(query);
	const literal = toLiteralQuery(normalized);
	const caseInsensitive = deps.caseInsensitiveFs ?? DEFAULT_CASE_INSENSITIVE_FS;

	const byPath = new Map<string, MentionItem>();
	const add = (item: MentionItem) => {
		const posix = toPosix(item.path);
		// Case is folded only where the filesystem itself folds it. On Linux
		// `src/Foo.ts` and `src/foo.ts` are two files and both belong in the list.
		const key = caseInsensitive ? posix.toLowerCase() : posix;
		if (!byPath.has(key)) {
			byPath.set(key, item);
		}
	};

	const ranked = () =>
		[...byPath.values()]
			.sort((a, b) => compareItems(a, b, literal))
			.slice(0, limit);

	// Open editors first — both because they need no search and because the
	// dedupe above must keep the `isEditor` flag when a path appears twice.
	for (const abs of deps.openEditors()) {
		const item = makeItem(abs, deps.workspaceRoot, 'file', true);
		if (matchesQuery(item, literal)) {
			add(item);
		}
	}

	const segment = lastSegment(normalized);
	const literalSegment = toLiteralQuery(segment);

	// A query with no literal characters left (`@**`, `@?`) would widen to a
	// match-everything glob whose results nothing could then match. Answer from
	// the open editors already collected rather than scanning the whole
	// workspace only to throw every result away.
	if (!literal || !literalSegment) {
		return ranked();
	}

	const fragment = toGlobFragment(segment);
	const [files, filesUnderDirs] = await Promise.all([
		deps.findFiles(`**/*${fragment}*`, SEARCH_LIMIT),
		deps.findFiles(`**/*${fragment}*/**`, SEARCH_LIMIT),
	]);

	for (const abs of files) {
		const item = makeItem(abs, deps.workspaceRoot, 'file', false);
		if (matchesQuery(item, literal)) {
			add(item);
		}
	}

	for (const abs of filesUnderDirs) {
		for (const dir of matchingAncestors(abs, deps.workspaceRoot, literalSegment)) {
			const item = makeItem(dir, deps.workspaceRoot, 'folder', false);
			if (matchesQuery(item, literal)) {
				add(item);
			}
		}
	}

	return ranked();
}
