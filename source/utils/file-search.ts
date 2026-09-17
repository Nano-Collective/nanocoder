import {spawn} from 'node:child_process';
import type {Dirent} from 'node:fs';
import {existsSync, readFileSync} from 'node:fs';
import {
	lstat,
	mkdtemp,
	readdir,
	readFile,
	rm,
	writeFile,
} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import ignore from 'ignore';
import {LRUCache} from 'lru-cache';

import {BINARY_FILE_EXTENSIONS} from '@/constants';
import {
	DEFAULT_IGNORE_DIRS,
	findNanocoderIgnoreFile,
	loadGitignore,
} from '@/utils/gitignore-loader';
import {getLogger} from '@/utils/logging';
import {resolveRipgrepPath} from '@/utils/ripgrep-path';

const MAX_CONTEXT_CONTENT_LENGTH = 1500;
const MAX_MATCH_CONTENT_LENGTH = 300;
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;
const MAX_RAW_FILES_SCANNED = 50_000;
const MAX_GLOB_PATTERN_LENGTH = 1000;

export class SearchTimeoutError extends Error {
	constructor(timeoutMs: number) {
		super(
			`Search timed out after ${Math.round(
				timeoutMs / 1000,
			)} seconds. Try a more specific query or narrower path.`,
		);
		this.name = 'SearchTimeoutError';
	}
}

export interface ProjectEntry {
	absolutePath: string;
	relativePath: string;
	isDirectory: boolean;
}

export interface SearchMatch {
	file: string;
	line: number;
	content: string;
}

function normalizePathForMatch(filePath: string): string {
	return filePath.replace(/\\/g, '/');
}

const MAX_BRACE_EXPANSIONS = 64;

function expandBraces(pattern: string): string[] {
	let combinationCount = 0;

	const expand = (current: string): string[] => {
		const match = current.match(/\{([^{}]+)\}/);
		if (!match || match.index === undefined) {
			combinationCount++;
			if (combinationCount > MAX_BRACE_EXPANSIONS) {
				throw new Error(
					`Glob pattern has too many brace-expansion combinations (max ${MAX_BRACE_EXPANSIONS}).`,
				);
			}
			return [current];
		}

		const before = current.slice(0, match.index);
		const after = current.slice(match.index + match[0].length);

		return match[1]
			.split(',')
			.flatMap(part => expand(`${before}${part.trim()}${after}`));
	};

	return expand(pattern);
}

type GlobToken =
	| {type: 'literal'; char: string}
	| {type: 'slash'}
	| {type: 'qmark'}
	| {type: 'star'}
	| {type: 'globstar'}
	| {type: 'globstarSlash'};

function tokenizeGlob(pattern: string): GlobToken[] {
	const tokens: GlobToken[] = [];
	let index = 0;
	while (index < pattern.length) {
		const char = pattern[index];
		if (char === '*') {
			if (pattern[index + 1] === '*') {
				if (pattern[index + 2] === '/') {
					tokens.push({type: 'globstarSlash'});
					index += 3;
				} else {
					tokens.push({type: 'globstar'});
					index += 2;
				}
			} else {
				tokens.push({type: 'star'});
				index += 1;
			}
			continue;
		}
		if (char === '?') {
			tokens.push({type: 'qmark'});
			index += 1;
			continue;
		}
		if (char === '/') {
			tokens.push({type: 'slash'});
			index += 1;
			continue;
		}
		tokens.push({type: 'literal', char});
		index += 1;
	}
	return tokens;
}

// DP table, not a compiled regex - no backtracking, so no ReDoS.
function matchTokens(text: string, tokens: GlobToken[]): boolean {
	const textLength = text.length;
	const tokenCount = tokens.length;

	let previousRow = new Array<boolean>(tokenCount + 1).fill(false);
	previousRow[0] = true;
	for (let tokenIndex = 1; tokenIndex <= tokenCount; tokenIndex++) {
		const token = tokens[tokenIndex - 1];
		previousRow[tokenIndex] =
			(token.type === 'star' ||
				token.type === 'globstar' ||
				token.type === 'globstarSlash') &&
			previousRow[tokenIndex - 1];
	}

	// True once any row hits this column - globstarSlash can start from any earlier row.
	const columnEverTrue = [...previousRow];

	for (let textIndex = 1; textIndex <= textLength; textIndex++) {
		const currentRow = new Array<boolean>(tokenCount + 1).fill(false);
		const textChar = text[textIndex - 1];

		for (let tokenIndex = 1; tokenIndex <= tokenCount; tokenIndex++) {
			const token = tokens[tokenIndex - 1];
			let matched: boolean;
			switch (token.type) {
				case 'literal':
					matched = previousRow[tokenIndex - 1] && textChar === token.char;
					break;
				case 'slash':
					matched = previousRow[tokenIndex - 1] && textChar === '/';
					break;
				case 'qmark':
					matched = previousRow[tokenIndex - 1] && textChar !== '/';
					break;
				case 'star':
					matched =
						currentRow[tokenIndex - 1] ||
						(previousRow[tokenIndex] && textChar !== '/');
					break;
				case 'globstar':
					matched = currentRow[tokenIndex - 1] || previousRow[tokenIndex];
					break;
				case 'globstarSlash':
					matched =
						currentRow[tokenIndex - 1] ||
						(textChar === '/' && columnEverTrue[tokenIndex - 1]);
					break;
			}
			currentRow[tokenIndex] = matched;
		}

		previousRow = currentRow;
		for (let tokenIndex = 0; tokenIndex <= tokenCount; tokenIndex++) {
			columnEverTrue[tokenIndex] =
				columnEverTrue[tokenIndex] || currentRow[tokenIndex];
		}
	}

	return previousRow[tokenCount];
}

// Bounds total tokens, not entry count - one entry can hold up to MAX_BRACE_EXPANSIONS arrays.
/** @internal Exported for direct unit testing only. */
export const GLOB_TOKEN_CACHE_MAX_TOKENS = 1_000_000;

/** @internal Exported for direct unit testing only. */
export const globTokenCache = new LRUCache<string, GlobToken[][]>({
	maxSize: GLOB_TOKEN_CACHE_MAX_TOKENS,
	sizeCalculation: tokenized =>
		tokenized.reduce((sum, tokens) => sum + tokens.length, 0),
});

function tokenizeExpandedPattern(pattern: string): GlobToken[][] {
	const cached = globTokenCache.get(pattern);
	if (cached) {
		return cached;
	}

	if (pattern.length > MAX_GLOB_PATTERN_LENGTH) {
		throw new Error(
			`Glob pattern is too long (${pattern.length} chars, max ${MAX_GLOB_PATTERN_LENGTH}).`,
		);
	}

	const normalizedPattern = normalizePathForMatch(pattern);
	const tokenized = expandBraces(normalizedPattern).map(tokenizeGlob);

	globTokenCache.set(pattern, tokenized);
	return tokenized;
}

export function matchesGlob(
	filePath: string,
	pattern: string,
	matchBasename = false,
): boolean {
	const normalizedPath = normalizePathForMatch(filePath);
	const target = matchBasename
		? path.posix.basename(normalizedPath)
		: normalizedPath;
	return tokenizeExpandedPattern(pattern).some(tokens =>
		matchTokens(target, tokens),
	);
}

function defaultIgnoreGlobs(
	projectIgnore: ReturnType<typeof loadGitignore>,
): string[] {
	const globs: string[] = [];
	for (const dir of DEFAULT_IGNORE_DIRS) {
		if (projectIgnore.ignores(dir)) {
			globs.push('-g', `!${dir}`);
		}
	}
	return globs;
}

function gitignoreRuleHasSlash(pattern: string): boolean {
	return pattern.startsWith('/') || pattern.replace(/\/$/, '').includes('/');
}

/**
 * git strips unescaped trailing whitespace from an ignore pattern, but a
 * backslash-escaped trailing space is a literal part of the rule (`foo\ `). A
 * plain `trimEnd` mangles that rare shape, so match git's rule.
 */
function trimGitignoreLine(line: string): string {
	const stripped = line.trimEnd();
	if (line === stripped) {
		return line;
	}
	let backslashes = 0;
	for (let i = stripped.length - 1; i >= 0 && stripped[i] === '\\'; i--) {
		backslashes++;
	}
	// An odd backslash run escapes the first removed character (the space).
	return backslashes % 2 === 1 ? line : stripped;
}

/**
 * Re-expresses one cwd-relative gitignore rule against a deeper search root so
 * it can be handed to rg in an `--ignore-file`, whose rules rg applies relative
 * to the search root.
 *
 * Unanchored rules (`foo`, `foo/`, `*.log`) match a path segment at any depth
 * and carry over unchanged. Rules that begin with `**` followed by a `/` are
 * git's depth-agnostic form and also carry over unchanged. Rules anchored at
 * cwd - a leading `/` or any `/` in the body - resolve against cwd and are
 * re-expressed relative to `searchRoot`, so `cwd/src/generated/` becomes
 * `/generated/` when searching `cwd/src`. Rules that resolve outside the search
 * root are dropped: nothing inside it can match them. Returns undefined for
 * blank and comment lines.
 *
 * @internal Exported for direct unit testing only.
 */
export function rebaseIgnoreLine(
	line: string,
	cwd: string,
	searchRoot: string,
): string | undefined {
	const trimmed = trimGitignoreLine(line);
	if (!trimmed || trimmed.startsWith('#')) {
		return undefined;
	}

	const negated = trimmed.startsWith('!');
	const pattern = negated ? trimmed.slice(1) : trimmed;
	if (!pattern || pattern === '/') {
		return undefined;
	}

	// Unanchored rules match a path segment at any depth, so they stay valid
	// unchanged under any search root.
	if (!gitignoreRuleHasSlash(pattern)) {
		return trimmed;
	}

	// `**/foo` matches foo at any depth (gitignore spec), so it is not anchored
	// to cwd and carries over unchanged.
	if (pattern.startsWith('**/')) {
		return trimmed;
	}

	const dirOnly = pattern.endsWith('/');
	const body = pattern.replace(/^\/+/, '').replace(/\/+$/, '');
	const relative = normalizePathForMatch(
		path.relative(searchRoot, path.resolve(cwd, body)),
	);
	// `path.relative` yields an absolute path when `cwd` and `searchRoot` are on
	// different Windows drives; such a rule can never match inside searchRoot.
	if (
		!relative ||
		path.isAbsolute(relative) ||
		relative === '..' ||
		relative.startsWith('../')
	) {
		return undefined;
	}
	return `${negated ? '!' : ''}/${relative}${dirOnly ? '/' : ''}`;
}

/**
 * The project's ignore rules, re-expressed against `searchRoot`.
 *
 * Mirrors {@link loadGitignore}'s layering exactly - defaults, then .gitignore,
 * then .nanocoderignore - so a later `!` re-include can still override an
 * earlier rule once rg parses the merged file.
 */
function projectIgnoreLines(cwd: string, searchRoot: string): string[] {
	const lines = [...DEFAULT_IGNORE_DIRS];
	const ignoreFiles = [
		path.join(cwd, '.gitignore'),
		findNanocoderIgnoreFile(cwd),
	];

	for (const ignoreFile of ignoreFiles) {
		if (ignoreFile === undefined) {
			continue;
		}

		let content: string;
		try {
			content = readFileSync(ignoreFile, 'utf-8');
		} catch {
			continue;
		}

		for (const line of content.split(/\r?\n/)) {
			// Blank and comment lines are no-ops for rg, so the temp file's line
			// count stays comparable to DEFAULT_IGNORE_DIRS - letting withProjectIgnoreFile skip an empty/comment-only .gitignore.
			const trimmed = trimGitignoreLine(line);
			if (!trimmed || trimmed.startsWith('#')) {
				continue;
			}
			if (searchRoot === cwd) {
				lines.push(line);
				continue;
			}
			const rebased = rebaseIgnoreLine(line, cwd, searchRoot);
			if (rebased !== undefined) {
				lines.push(rebased);
			}
		}
	}

	return lines;
}

/**
 * Runs `run` with the project's ignore rules handed to rg as an `--ignore-file`,
 * so rg prunes ignored paths during traversal instead of streaming matches that
 * the JS-side filter will drop (#1341).
 *
 * rg applies `--ignore-file` rules relative to the search root, so an unanchored
 * `dist/` still prunes a nested `src/dist/`; anchored cwd rules are re-based by
 * {@link rebaseIgnoreLine}.
 *
 * Projects without a .gitignore or .nanocoderignore are skipped: their only
 * rules are the DEFAULT_IGNORE_DIRS, which `defaultIgnoreGlobs` already prunes
 * during traversal, so a temp file would add nothing.
 */
async function withProjectIgnoreFile<T>(
	cwd: string,
	searchRoot: string,
	run: (ignoreArgs: string[]) => Promise<T>,
): Promise<T> {
	if (
		!existsSync(path.join(cwd, '.gitignore')) &&
		findNanocoderIgnoreFile(cwd) === undefined
	) {
		return run([]);
	}

	const ignoreLines = projectIgnoreLines(cwd, searchRoot);
	// An ignore file that only repeats the DEFAULT_IGNORE_DIRS (e.g. an empty or
	// comment-only .gitignore, or rules that all resolve outside the search
	// root) prunes nothing beyond what defaultIgnoreGlobs already prunes during
	// traversal, so no temp file is needed.
	if (ignoreLines.length === DEFAULT_IGNORE_DIRS.length) {
		return run([]);
	}

	const tempDir = await mkdtemp(path.join(tmpdir(), 'nanocoder-ignore-'));
	try {
		const ignoreFile = path.join(tempDir, 'ignore');
		await writeFile(ignoreFile, `${ignoreLines.join('\n')}\n`, {
			encoding: 'utf-8',
			mode: 0o600,
		});
		return await run(['--ignore-file', normalizePathForMatch(ignoreFile)]);
	} finally {
		await rm(tempDir, {recursive: true, force: true});
	}
}

async function assertPathExists(candidatePath: string): Promise<void> {
	await lstat(candidatePath);
}

// Possessive quantifiers parse under rg's default engine with different (wrong) semantics - the one case --engine auto can't self-detect.
const POSSESSIVE_QUANTIFIER_PATTERN = /[*+?]\+|\}\+/;

function binaryExcludeGlobs(): string[] {
	const globs: string[] = [];
	for (const ext of BINARY_FILE_EXTENSIONS) {
		globs.push('-g', `!*${ext}`);
	}
	return globs;
}

interface RunRipgrepResult {
	stdout: string;
	hitMaxLines: boolean;
}

async function runRipgrep(
	args: string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
	maxLines?: number,
	// The caller decides per line whether to keep it ('keep'), drop it ('skip'),
	// or kill the scan now ('stop'). 'stop' double-counts as 'keep' for its own
	// line. With onLine set, stdout only ever holds 'keep'/'stop' lines, so an
	// ignored dir's matches can't stream into memory unboundedly.
	onLine?: (line: string) => 'keep' | 'skip' | 'stop',
): Promise<RunRipgrepResult> {
	const rgPath = await resolveRipgrepPath();

	return new Promise((resolve, reject) => {
		// No `signal`/`timeout` in spawn options - Node's own handling leaks state. Own both.
		const child = spawn(rgPath, args, {cwd});
		let stdout = '';
		let stderr = '';
		let killedForLimit = false;
		let hitMaxLines = false;
		let timedOut = false;
		let lineCount = 0;
		let receivedOutput = false;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		let lineRemainder = '';

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			// This runs on the stream's event loop turn, not inside the promise
			// executor, so a throw from onLine would escape as an uncaught
			// exception and take the process down instead of failing the search.
			try {
				consumeChunk(chunk);
			} catch (err) {
				// Reusing killedForLimit to ignore any chunks still in flight. The
				// promise is already rejected, so the close handler's resolve is a no-op.
				killedForLimit = true;
				child.kill();
				reject(err instanceof Error ? err : new Error(String(err)));
			}
		});

		function consumeChunk(chunk: string): void {
			if (killedForLimit) {
				return;
			}
			receivedOutput = true;

			if (maxLines === undefined && onLine === undefined) {
				stdout += chunk;
				return;
			}

			// Chunks aren't line-aligned - with onLine set, stdout is built only
			// from 'keep'/'stop' lines, so it can't overshoot the cap or grow from
			// lines the caller will drop.
			lineRemainder += chunk;
			let newlineIndex = lineRemainder.indexOf('\n');
			while (newlineIndex >= 0) {
				const line = lineRemainder.slice(0, newlineIndex);
				lineRemainder = lineRemainder.slice(newlineIndex + 1);

				const action = onLine?.(line) ?? 'keep';
				if (action !== 'skip') {
					stdout += line + '\n';
				}
				if (action === 'stop') {
					killedForLimit = true;
					child.kill();
					return;
				}

				if (line && maxLines !== undefined) {
					lineCount++;
					if (lineCount >= maxLines) {
						killedForLimit = true;
						hitMaxLines = true;
						child.kill();
						return;
					}
				}

				newlineIndex = lineRemainder.indexOf('\n');
			}
		}

		child.stderr.setEncoding('utf8');
		child.stderr.on('data', (chunk: string) => {
			stderr += chunk;
		});

		const onAbort = () => {
			child.kill();
		};
		signal?.addEventListener('abort', onAbort);

		child.on('error', err => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);
			reject(err);
		});

		child.on('close', (code, closeSignal) => {
			clearTimeout(timer);
			signal?.removeEventListener('abort', onAbort);

			if (signal?.aborted) {
				reject(signal.reason ?? new Error('Search aborted'));
				return;
			}
			if (killedForLimit) {
				resolve({stdout, hitMaxLines});
				return;
			}
			if (timedOut) {
				reject(new SearchTimeoutError(timeoutMs));
				return;
			}
			// code is null when rg was killed by a signal we didn't send (e.g. OOM killer).
			if (closeSignal) {
				reject(new Error(`ripgrep terminated by signal ${closeSignal}`));
				return;
			}
			// Exit 1 = no matches. Exit 2 with output is a recoverable mid-scan warning
			// (one unreadable subdirectory, say) - rg scanned the rest, so keep it.
			//
			// Exit 2 with nothing on stdout means the search never produced anything:
			// an unreadable root, a rejected argument, a build without PCRE2 (real on
			// Linux ARM). Deliberately no stderr allowlist here - anything rg says that
			// nobody enumerated would otherwise fall through to `resolve('')`, and every
			// caller reads that as a genuine "no results" rather than a failure.
			if (code !== null && code > 1 && !receivedOutput) {
				reject(
					new Error(
						`ripgrep exited with code ${code}: ${
							stderr.trim() || 'no error output'
						}`,
					),
				);
				return;
			}
			resolve({stdout, hitMaxLines: false});
		});
	});
}

const MAX_WALK_DEPTH = 200;

// Unanchored `foo` matches any depth (dirPrefix/**/foo); anchored patterns stay scoped (dirPrefix/foo).
function prefixGitignoreLine(
	line: string,
	dirPrefix: string,
): string | undefined {
	const trimmed = trimGitignoreLine(line);
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

async function walkEmptyDirectories(
	cwd: string,
	rootPath: string,
	seenDirs: Set<string>,
	onEntry: (entry: ProjectEntry) => boolean | Promise<boolean>,
	projectIgnore: ReturnType<typeof loadGitignore>,
	signal?: AbortSignal,
	maxDirsWalked: number = MAX_RAW_FILES_SCANNED,
): Promise<{truncated: boolean}> {
	// Seeded from projectIgnore for correct rule order; nested .gitignore merges in with higher precedence, same as git.
	const ig = ignore();
	ig.add(projectIgnore);
	let loggedDepthCap = false;
	let dirsWalked = 0;
	let hitDirCap = false;

	const visit = async (
		absolutePath: string,
		depth: number,
	): Promise<boolean> => {
		if (signal?.aborted) {
			throw signal.reason ?? new Error('Walk aborted');
		}

		if (depth > MAX_WALK_DEPTH) {
			if (!loggedDepthCap) {
				loggedDepthCap = true;
				getLogger().warn(
					{cwd, maxDepth: MAX_WALK_DEPTH},
					'walkEmptyDirectories: hit max depth, some directories were not walked',
				);
			}
			return false;
		}

		// readdir itself is the expensive part; cap on that, not on discovered entries.
		dirsWalked++;
		if (dirsWalked > maxDirsWalked) {
			hitDirCap = true;
			return true;
		}

		const dirPrefix = normalizePathForMatch(path.relative(cwd, absolutePath));
		// cwd's .gitignore is already in projectIgnore - re-reading it would duplicate and invert precedence.
		if (dirPrefix !== '') {
			const gitignoreContent = await readFile(
				path.join(absolutePath, '.gitignore'),
				'utf-8',
			).catch(() => undefined);
			if (gitignoreContent !== undefined) {
				const patterns = gitignoreContent
					.split('\n')
					.map(line => prefixGitignoreLine(line, dirPrefix))
					.filter((line): line is string => line !== undefined);
				if (patterns.length > 0) {
					ig.add(patterns);
				}
			}
		}

		let children: Dirent[];
		try {
			children = await readdir(absolutePath, {withFileTypes: true});
		} catch {
			return false;
		}

		for (const child of children) {
			if (!child.isDirectory()) {
				continue;
			}

			const childAbsolutePath = path.join(absolutePath, child.name);
			const childRelativePath = normalizePathForMatch(
				path.relative(cwd, childAbsolutePath),
			);

			// child is a directory; ignore needs a trailing slash to match directory-only patterns like "dist/".
			if (ig.ignores(`${childRelativePath}/`)) {
				continue;
			}

			if (!seenDirs.has(childRelativePath)) {
				seenDirs.add(childRelativePath);
				const stop = await onEntry({
					absolutePath: childAbsolutePath,
					relativePath: childRelativePath,
					isDirectory: true,
				});
				if (stop) {
					return true;
				}
			}

			if (await visit(childAbsolutePath, depth + 1)) {
				return true;
			}
		}

		return false;
	};

	await visit(rootPath, 0);
	return {truncated: hitDirCap};
}

export interface WalkProjectEntriesOptions {
	/** Emit directory entries alongside files. Defaults to true. */
	includeDirectories?: boolean;
	signal?: AbortSignal;
	maxRawFilesScanned?: number;
	/**
	 * Sort entries by path. Defaults to true.
	 *
	 * Unsorted streams results early but isn't guaranteed faster - rg's
	 * discovery order is non-deterministic.
	 *
	 * `sorted: false` reads entries off rg's stdout as it arrives, so `onEntry`
	 * MUST be synchronous there: returning a promise would let the stream run
	 * ahead of the callback. The overloads below make that a compile error, and
	 * {@link emitEntrySync} throws if a JS caller slips one through anyway.
	 */
	sorted?: boolean;
}

/** `onEntry` shape accepted when entries stream in unsorted - no promises. */
export type SyncProjectEntryVisitor = (entry: ProjectEntry) => boolean;

/** `onEntry` shape accepted when entries are sorted and emitted one at a time. */
export type ProjectEntryVisitor = (
	entry: ProjectEntry,
) => boolean | Promise<boolean>;

function emitEntrySync(
	onEntry: ProjectEntryVisitor,
	entry: ProjectEntry,
): boolean {
	const stop = onEntry(entry);
	if (stop instanceof Promise) {
		throw new Error(
			'walkProjectEntries: onEntry must be synchronous when sorted: false',
		);
	}
	return stop;
}

async function walkUnsortedFileStream(
	cwd: string,
	rootPath: string,
	args: string[],
	onEntry: ProjectEntryVisitor,
	includeDirectories: boolean,
	projectIgnore: ReturnType<typeof loadGitignore>,
	signal: AbortSignal | undefined,
	maxRawFilesScanned: number,
): Promise<{truncated: boolean}> {
	const seenDirs = new Set<string>();
	let stoppedEarly = false;

	const onLine = (line: string): 'keep' | 'skip' | 'stop' => {
		const file = normalizePathForMatch(line);
		if (!file) {
			return 'skip';
		}

		const relativeFile = normalizePathForMatch(path.relative(cwd, file));
		// rg already pruned these via --ignore-file; kept as a backstop because
		// its matcher and the `ignore` package are separate implementations.
		if (projectIgnore.ignores(relativeFile)) {
			return 'skip';
		}

		if (includeDirectories) {
			const parts = relativeFile.split('/');
			let dirRelative = '';
			for (let index = 0; index < parts.length - 1; index++) {
				dirRelative = index === 0 ? parts[0] : `${dirRelative}/${parts[index]}`;
				if (seenDirs.has(dirRelative)) {
					continue;
				}
				seenDirs.add(dirRelative);
				if (
					emitEntrySync(onEntry, {
						absolutePath: path.join(cwd, dirRelative),
						relativePath: dirRelative,
						isDirectory: true,
					})
				) {
					stoppedEarly = true;
					return 'stop';
				}
			}
		}

		if (
			emitEntrySync(onEntry, {
				absolutePath: path.join(cwd, relativeFile),
				relativePath: relativeFile,
				isDirectory: false,
			})
		) {
			stoppedEarly = true;
			return 'stop';
		}

		return 'skip';
	};

	const {hitMaxLines} = await runRipgrep(
		args,
		cwd,
		DEFAULT_SEARCH_TIMEOUT_MS,
		signal,
		maxRawFilesScanned,
		onLine,
	);

	if (stoppedEarly) {
		return {truncated: hitMaxLines};
	}

	let hitDirCap = false;
	if (includeDirectories && !hitMaxLines) {
		({truncated: hitDirCap} = await walkEmptyDirectories(
			cwd,
			rootPath,
			seenDirs,
			onEntry,
			projectIgnore,
			signal,
			maxRawFilesScanned,
		));
	}

	return {truncated: hitMaxLines || hitDirCap};
}

/**
 * Walk every non-ignored file (and, by default, directory) under `startPath`,
 * calling `onEntry` for each. Return true from `onEntry` to stop the walk.
 *
 * With `sorted: false`, entries stream straight off rg's stdout and `onEntry`
 * must be synchronous - see {@link WalkProjectEntriesOptions.sorted}.
 */
export async function walkProjectEntries(
	cwd: string,
	startPath: string | undefined,
	onEntry: SyncProjectEntryVisitor,
	options: WalkProjectEntriesOptions & {sorted: false},
): Promise<{truncated: boolean}>;
export async function walkProjectEntries(
	cwd: string,
	startPath: string | undefined,
	onEntry: ProjectEntryVisitor,
	options?: WalkProjectEntriesOptions & {sorted?: true},
): Promise<{truncated: boolean}>;
export async function walkProjectEntries(
	cwd: string,
	startPath: string | undefined,
	onEntry: ProjectEntryVisitor,
	options: WalkProjectEntriesOptions = {},
): Promise<{truncated: boolean}> {
	const {
		includeDirectories = true,
		signal,
		maxRawFilesScanned = MAX_RAW_FILES_SCANNED,
		sorted = true,
	} = options;
	const rootPath = startPath ?? cwd;
	await assertPathExists(rootPath);
	const projectIgnore = loadGitignore(cwd);

	return withProjectIgnoreFile(cwd, rootPath, async ignoreArgs => {
		const args = [
			'--files',
			'--hidden',
			// No --follow (symlinks could escape cwd); --no-require-git works without a repo.
			'--no-ignore-parent',
			'--no-require-git',
			'--no-config',
			...(sorted ? ['--sort', 'path'] : []),
			...ignoreArgs,
			...defaultIgnoreGlobs(projectIgnore),
			'--',
			rootPath,
		];

		if (!sorted) {
			return walkUnsortedFileStream(
				cwd,
				rootPath,
				args,
				onEntry,
				includeDirectories,
				projectIgnore,
				signal,
				maxRawFilesScanned,
			);
		}

		const {stdout, hitMaxLines} = await runRipgrep(
			args,
			cwd,
			DEFAULT_SEARCH_TIMEOUT_MS,
			signal,
			maxRawFilesScanned,
		);
		const files = stdout
			.split(/\r?\n/)
			.filter(Boolean)
			.map(normalizePathForMatch);

		const seenDirs = new Set<string>();
		for (const file of files) {
			if (signal?.aborted) {
				throw signal.reason ?? new Error('Walk aborted');
			}

			const relativeFile = normalizePathForMatch(path.relative(cwd, file));
			if (projectIgnore.ignores(relativeFile)) {
				continue;
			}

			if (includeDirectories) {
				const parts = relativeFile.split('/');

				let dirRelative = '';
				for (let index = 0; index < parts.length - 1; index++) {
					dirRelative =
						index === 0 ? parts[0] : `${dirRelative}/${parts[index]}`;
					if (seenDirs.has(dirRelative)) {
						continue;
					}
					seenDirs.add(dirRelative);
					const stop = await onEntry({
						absolutePath: path.join(cwd, dirRelative),
						relativePath: dirRelative,
						isDirectory: true,
					});
					if (stop) {
						return {truncated: hitMaxLines};
					}
				}
			}

			const stop = await onEntry({
				absolutePath: path.join(cwd, relativeFile),
				relativePath: relativeFile,
				isDirectory: false,
			});
			if (stop) {
				return {truncated: hitMaxLines};
			}
		}

		let hitDirCap = false;
		if (includeDirectories && !hitMaxLines) {
			({truncated: hitDirCap} = await walkEmptyDirectories(
				cwd,
				rootPath,
				seenDirs,
				onEntry,
				projectIgnore,
				signal,
				maxRawFilesScanned,
			));
		}

		return {truncated: hitMaxLines || hitDirCap};
	});
}

export async function findMatchingPaths(
	pattern: string,
	cwd: string,
	maxResults: number,
): Promise<{files: string[]; truncated: boolean}> {
	if (maxResults <= 0) {
		// The push-then-check loop below always lets one entry through first.
		return {files: [], truncated: false};
	}

	const hasSlash = normalizePathForMatch(pattern).includes('/');
	const files: string[] = [];
	let truncated = false;

	const walkResult = await walkProjectEntries(
		cwd,
		undefined,
		entry => {
			if (matchesGlob(entry.relativePath, pattern, !hasSlash)) {
				files.push(normalizePathForMatch(entry.relativePath));
				if (files.length >= maxResults) {
					truncated = true;
					return true;
				}
			}

			return false;
		},
		{sorted: false},
	);
	truncated = truncated || walkResult.truncated;

	return {files, truncated};
}

function formatMatchContent(content: string, maxLength: number): string {
	if (content.length <= maxLength) {
		return content;
	}
	return `${content.slice(0, maxLength)}…`;
}

interface RgJsonMatch {
	type: string;
	data: {
		path?: {text?: string};
		line_number?: number;
		lines?: {text?: string};
	};
}

function parseRgJsonLines(stdout: string): Array<{
	type: 'match' | 'context';
	file: string;
	lineNumber: number;
	text?: string;
}> {
	const results: Array<{
		type: 'match' | 'context';
		file: string;
		lineNumber: number;
		text?: string;
	}> = [];
	for (const line of stdout.split('\n')) {
		if (!line) {
			continue;
		}
		let parsed: RgJsonMatch;
		try {
			parsed = JSON.parse(line);
		} catch {
			continue;
		}
		if (parsed.type !== 'match' && parsed.type !== 'context') {
			continue;
		}
		const file = parsed.data.path?.text;
		const lineNumber = parsed.data.line_number;
		if (file === undefined || lineNumber === undefined) {
			continue;
		}
		results.push({
			type: parsed.type,
			file: normalizePathForMatch(file),
			lineNumber,
			text: parsed.data.lines?.text,
		});
	}
	return results;
}

type RgLine = ReturnType<typeof parseRgJsonLines>[number];

function toRelativeFile(cwd: string, file: string): string {
	const absolutePath = path.isAbsolute(file) ? file : path.join(cwd, file);
	return normalizePathForMatch(path.relative(cwd, absolutePath));
}

function buildMatchesWithoutContext(
	rgLines: RgLine[],
	cwd: string,
	maxResults: number,
): {matches: SearchMatch[]; truncated: boolean} {
	const matches: SearchMatch[] = [];
	let truncated = false;

	for (const {file, lineNumber, text} of rgLines) {
		if (text === undefined) {
			continue;
		}

		matches.push({
			file: toRelativeFile(cwd, file),
			line: lineNumber,
			content: formatMatchContent(
				text.replace(/\r?\n$/, '').trim(),
				MAX_MATCH_CONTENT_LENGTH,
			),
		});

		if (matches.length >= maxResults) {
			truncated = true;
			break;
		}
	}

	return {matches, truncated};
}

function buildMatchesWithContext(
	rgLines: RgLine[],
	cwd: string,
	maxResults: number,
	contextLines: number,
): {matches: SearchMatch[]; truncated: boolean} {
	const textByFileAndLine = new Map<string, Map<number, string>>();
	const matchLinesByFile = new Map<string, number[]>();

	for (const {type, file, lineNumber, text} of rgLines) {
		if (text !== undefined) {
			let byLine = textByFileAndLine.get(file);
			if (!byLine) {
				byLine = new Map();
				textByFileAndLine.set(file, byLine);
			}
			byLine.set(lineNumber, text.replace(/\r?\n$/, ''));
		}

		if (type === 'match') {
			const existing = matchLinesByFile.get(file);
			if (existing) {
				existing.push(lineNumber);
			} else {
				matchLinesByFile.set(file, [lineNumber]);
			}
		}
	}

	const matches: SearchMatch[] = [];
	let truncated = false;

	outer: for (const [file, matchLines] of matchLinesByFile) {
		const byLine = textByFileAndLine.get(file);
		const relativeFile = toRelativeFile(cwd, file);

		for (const lineNumber of matchLines) {
			if (byLine?.get(lineNumber) === undefined) {
				continue;
			}

			const blockLines: string[] = [];
			for (
				let line = lineNumber - contextLines;
				line <= lineNumber + contextLines;
				line++
			) {
				const lineText = byLine?.get(line);
				if (lineText !== undefined) {
					blockLines.push(`${line}: ${lineText}`);
				}
			}

			matches.push({
				file: relativeFile,
				line: lineNumber,
				content: formatMatchContent(
					blockLines.join('\n'),
					MAX_CONTEXT_CONTENT_LENGTH,
				),
			});

			if (matches.length >= maxResults) {
				truncated = true;
				break outer;
			}
		}
	}

	return {matches, truncated};
}

export async function searchProjectContents(
	query: string,
	cwd: string,
	maxResults: number,
	caseSensitive: boolean,
	include?: string,
	searchPath?: string,
	wholeWord?: boolean,
	contextLines?: number,
	timeoutMs: number = DEFAULT_SEARCH_TIMEOUT_MS,
	signal?: AbortSignal,
): Promise<{matches: SearchMatch[]; truncated: boolean}> {
	if (maxResults <= 0) {
		return {matches: [], truncated: false};
	}
	if (!query.trim()) {
		throw new Error('Search query cannot be empty');
	}
	const searchRoot = searchPath ?? cwd;
	await assertPathExists(searchRoot);

	const projectIgnore = loadGitignore(cwd);

	const args = [
		'--json',
		'--hidden',
		'--no-ignore-parent',
		'--no-require-git',
		'--no-config',
		'--sort',
		'path',
		caseSensitive ? '--case-sensitive' : '--ignore-case',
	];
	if (wholeWord) {
		args.push('--word-regexp');
	}
	args.push(
		'--engine',
		POSSESSIVE_QUANTIFIER_PATTERN.test(query) ? 'pcre2' : 'auto',
	);
	// Must precede the exclude globs: rg's `-g` is last-wins, so an include after would re-include them.
	if (include) {
		args.push('-g', include);
	}
	const normalizedContextLines = Math.max(0, contextLines ?? 0);

	// No --max-count (overshoots with --context) - headroom of contextLines covers each kept match's own trailing context.
	const rgMaxCount = Math.max(0, maxResults) + normalizedContextLines;
	let keptMatchCount = 0;

	// Only matches that survive the downstream projectIgnore filter may spend the
	// kill budget. Counting raw matches let a gitignored directory walked first
	// kill rg before any real match streamed in - the matches were then dropped
	// downstream, so the search reported "no matches" despite real ones (#1341).
	//
	// The ignored-status of every line depends only on its file (projectIgnore is
	// per-path), so a kept file's match AND context lines are all kept while an
	// ignored file's lines are all dropped. Dropping them at source is what keeps
	// an un-prunable ignored dir from streaming unbounded output (#1341 backstop).
	const onLine = (line: string): 'keep' | 'skip' | 'stop' => {
		let parsed: RgJsonMatch;
		try {
			parsed = JSON.parse(line) as RgJsonMatch;
		} catch {
			return 'skip';
		}
		const file = parsed.data.path?.text;
		if (parsed.type !== 'match' && parsed.type !== 'context') {
			return 'skip';
		}
		if (file === undefined) {
			return 'skip';
		}
		if (projectIgnore.ignores(toRelativeFile(cwd, file))) {
			return 'skip';
		}
		if (parsed.type === 'match') {
			keptMatchCount++;
			if (keptMatchCount >= rgMaxCount) {
				return 'stop';
			}
		}
		return 'keep';
	};

	const {stdout} = await withProjectIgnoreFile(
		cwd,
		searchRoot,
		async ignoreArgs => {
			const searchArgs = [
				...args,
				...ignoreArgs,
				...defaultIgnoreGlobs(projectIgnore),
				...binaryExcludeGlobs(),
			];
			if (normalizedContextLines > 0) {
				searchArgs.push('--context', String(normalizedContextLines));
			}
			searchArgs.push('--regexp', query, '--', searchRoot);

			return runRipgrep(searchArgs, cwd, timeoutMs, signal, undefined, onLine);
		},
	);
	const rgLines = parseRgJsonLines(stdout).filter(
		line => !projectIgnore.ignores(toRelativeFile(cwd, line.file)),
	);

	return normalizedContextLines > 0
		? buildMatchesWithContext(rgLines, cwd, maxResults, normalizedContextLines)
		: buildMatchesWithoutContext(rgLines, cwd, maxResults);
}
