/**
 * Workspace search behind the composer's `@` autocomplete.
 *
 * This module deliberately imports nothing from `vscode` so it can be unit
 * tested outside the extension host — the caller injects the two APIs it needs
 * (see `mention-search.spec.ts`). `chat-webview-provider.ts` supplies the real
 * `vscode.workspace.findFiles` / `vscode.window.tabGroups` implementations.
 */

export type MentionKind = 'file' | 'folder';

/**
 * Where a suggestion came from. Drives both the dropdown grouping hint and the
 * ranking bonus — open editors are what the user is most likely to mean.
 */
export type MentionSource = 'editor' | 'file' | 'folder';

export interface MentionItem {
	/** Absolute path — what the composer stores in `attachedPaths`. */
	path: string;
	/** Basename, used as the chip label and the dropdown's primary line. */
	name: string;
	/** Workspace-relative, forward slashes — the dropdown's secondary line. */
	relPath: string;
	kind: MentionKind;
	source: MentionSource;
}

export interface MentionSearchDeps {
	/** Absolute path of the workspace root. */
	workspaceRoot: string;
	/** Absolute paths of files currently open in editor tabs. */
	openEditors(): string[];
	/** Absolute paths matching a VS Code glob, capped at `limit`. */
	findFiles(glob: string, limit: number): Promise<string[]>;
}

/** Raw matches requested from VS Code before ranking and truncation. */
const SEARCH_LIMIT = 200;

/** Suggestions returned to the webview. */
export const MENTION_RESULT_LIMIT = 30;

/** Longest query we will search for; anything longer is a paste, not a mention. */
const MAX_QUERY_LENGTH = 120;

function toPosix(p: string): string {
	return p.replace(/\\/g, '/');
}

function basename(posixPath: string): string {
	const trimmed = posixPath.replace(/\/+$/, '');
	const idx = trimmed.lastIndexOf('/');
	return idx === -1 ? trimmed : trimmed.slice(idx + 1);
}

function dirname(posixPath: string): string {
	const trimmed = posixPath.replace(/\/+$/, '');
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
 * narrows the results back down using the raw query.
 */
export function toGlobFragment(query: string): string {
	return query
		.replace(/[*?[\]{}()!+@]/g, '*')
		.replace(/\*+/g, '*');
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
export function matchesQuery(item: MentionItem, normalizedQuery: string): boolean {
	if (!normalizedQuery) {
		return true;
	}
	if (normalizedQuery.includes('/')) {
		return item.relPath.toLowerCase().includes(normalizedQuery);
	}
	return item.name.toLowerCase().includes(normalizedQuery);
}

export function scoreItem(item: MentionItem, normalizedQuery: string): number {
	const name = item.name.toLowerCase();
	const rel = item.relPath.toLowerCase();

	let score: number;
	if (!normalizedQuery) {
		score = 0;
	} else if (name === normalizedQuery) {
		score = 100;
	} else if (name.startsWith(normalizedQuery)) {
		score = 80;
	} else if (name.includes(normalizedQuery)) {
		score = 60;
	} else if (rel.endsWith(normalizedQuery)) {
		score = 50;
	} else if (rel.includes(normalizedQuery)) {
		score = 40;
	} else {
		score = 0;
	}

	if (item.source === 'editor') {
		score += 25;
	} else if (item.source === 'folder') {
		score += 5;
	}
	return score;
}

/**
 * Score first, then shallower paths, then alphabetical. The last two keys make
 * the order fully deterministic, which is what lets the tests assert on it.
 */
function compareItems(
	a: MentionItem,
	b: MentionItem,
	normalizedQuery: string,
): number {
	const scoreDelta = scoreItem(b, normalizedQuery) - scoreItem(a, normalizedQuery);
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
	source: MentionSource,
): MentionItem {
	const relPath = toRelPath(absPath, workspaceRoot);
	return {
		path: absPath,
		name: basename(toPosix(absPath)) || relPath,
		relPath,
		kind,
		source,
	};
}

/**
 * Directories between `absPath` and the workspace root whose own name matches
 * the query. This is how folders get discovered at all: a filename glob like
 * `**\/*components*` never matches `src/components/`, only files named
 * "components".
 */
function matchingAncestors(
	absPath: string,
	workspaceRoot: string,
	segment: string,
): string[] {
	const root = toPosix(workspaceRoot).replace(/\/+$/, '').toLowerCase();
	const found: string[] = [];
	let dir = dirname(toPosix(absPath));

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
	/** Keyed by lowercased path so the first (highest-priority) source wins. */
	const byPath = new Map<string, MentionItem>();

	const add = (item: MentionItem) => {
		const key = toPosix(item.path).toLowerCase();
		if (!byPath.has(key)) {
			byPath.set(key, item);
		}
	};

	// Open editors first — both because they need no search and because the
	// dedupe below must keep the 'editor' source when a path appears twice.
	for (const abs of deps.openEditors()) {
		const item = makeItem(abs, deps.workspaceRoot, 'file', 'editor');
		if (matchesQuery(item, normalized)) {
			add(item);
		}
	}

	if (!normalized) {
		return [...byPath.values()]
			.sort((a, b) => compareItems(a, b, normalized))
			.slice(0, limit);
	}

	const segment = lastSegment(normalized);
	const fragment = toGlobFragment(segment);

	const [files, filesUnderDirs] = await Promise.all([
		deps.findFiles(`**/*${fragment}*`, SEARCH_LIMIT),
		deps.findFiles(`**/*${fragment}*/**`, SEARCH_LIMIT),
	]);

	for (const abs of files) {
		const item = makeItem(abs, deps.workspaceRoot, 'file', 'file');
		if (matchesQuery(item, normalized)) {
			add(item);
		}
	}

	for (const abs of filesUnderDirs) {
		for (const dir of matchingAncestors(abs, deps.workspaceRoot, segment)) {
			const item = makeItem(dir, deps.workspaceRoot, 'folder', 'folder');
			if (matchesQuery(item, normalized)) {
				add(item);
			}
		}
	}

	return [...byPath.values()]
		.sort((a, b) => compareItems(a, b, normalized))
		.slice(0, limit);
}
