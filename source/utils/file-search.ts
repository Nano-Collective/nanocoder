import {spawn} from 'node:child_process';
import type {Dirent} from 'node:fs';
import {readdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import ignore from 'ignore';

import {BINARY_FILE_EXTENSIONS} from '@/constants';
import {DEFAULT_IGNORE_DIRS} from '@/utils/gitignore-loader';
import {getLogger} from '@/utils/logging';
import {resolveRipgrepPath} from '@/utils/ripgrep-path';

const MAX_CONTEXT_CONTENT_LENGTH = 1500;
const MAX_MATCH_CONTENT_LENGTH = 300;
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;
// Sanity cap on pattern length, not a backtracking defense (matchTokens has none).
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

// Braces aren't nesting-aware; `{a,{b,c}}` expands wrong.
function expandBraces(pattern: string): string[] {
	const match = pattern.match(/\{([^{}]+)\}/);
	if (!match || match.index === undefined) {
		return [pattern];
	}

	const before = pattern.slice(0, match.index);
	const after = pattern.slice(match.index + match[0].length);

	return match[1]
		.split(',')
		.flatMap(part => expandBraces(`${before}${part.trim()}${after}`));
}

type GlobToken =
	| {type: 'literal'; char: string}
	| {type: 'slash'}
	| {type: 'qmark'}
	| {type: 'star'}
	| {type: 'globstar'}
	| {type: 'globstarSlash'};

// '**/' is its own token - unlike a bare '**', it can vanish entirely.
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

// Same pattern is checked per candidate path during a walk - cache the tokenized form.
const GLOB_TOKEN_CACHE_LIMIT = 500;
const globTokenCache = new Map<string, GlobToken[][]>();

function tokenizeExpandedPattern(pattern: string): GlobToken[][] {
	const cached = globTokenCache.get(pattern);
	if (cached) {
		globTokenCache.delete(pattern);
		globTokenCache.set(pattern, cached);
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
	if (globTokenCache.size > GLOB_TOKEN_CACHE_LIMIT) {
		const oldest = globTokenCache.keys().next().value;
		if (oldest !== undefined) {
			globTokenCache.delete(oldest);
		}
	}

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

// `-g '!name'` always wins over .gitignore, so a project can't re-include these via `!dist`.
function defaultIgnoreGlobs(): string[] {
	const globs: string[] = [];
	for (const dir of DEFAULT_IGNORE_DIRS) {
		globs.push('-g', `!${dir}`);
	}
	return globs;
}

function binaryExcludeGlobs(): string[] {
	const globs: string[] = [];
	for (const ext of BINARY_FILE_EXTENSIONS) {
		globs.push('-g', `!*${ext}`);
	}
	return globs;
}

// Real rg error strings, not guesses.
const FATAL_RIPGREP_ERROR_PATTERNS = [
	/regex parse error/,
	/error parsing glob/,
	/PCRE2: error compiling pattern/,
	/grep config error: unknown encoding/,
];

function isFatalRipgrepError(stderr: string): boolean {
	const firstLine = stderr.split('\n')[0]?.trim() ?? '';
	if (firstLine.startsWith('the literal')) {
		return true;
	}
	return FATAL_RIPGREP_ERROR_PATTERNS.some(pattern => pattern.test(stderr));
}

async function runRipgrep(
	args: string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
	maxMatches?: number,
): Promise<string> {
	const rgPath = await resolveRipgrepPath();

	return new Promise((resolve, reject) => {
		// No `signal`/`timeout` in spawn options - Node's own handling leaks state. Own both.
		const child = spawn(rgPath, args, {cwd});
		let stdout = '';
		let stderr = '';
		let killedForMatchLimit = false;
		let timedOut = false;
		let matchCount = 0;

		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, timeoutMs);
		// Buffers a chunk boundary that splits mid-line.
		let lineRemainder = '';

		child.stdout.setEncoding('utf8');
		child.stdout.on('data', (chunk: string) => {
			stdout += chunk;
			if (maxMatches === undefined || killedForMatchLimit) {
				return;
			}

			// rg's --max-count overshoots with --context, so count ourselves.
			lineRemainder += chunk;
			let newlineIndex = lineRemainder.indexOf('\n');
			while (newlineIndex >= 0) {
				const line = lineRemainder.slice(0, newlineIndex);
				lineRemainder = lineRemainder.slice(newlineIndex + 1);

				if (line) {
					try {
						if ((JSON.parse(line) as {type?: string}).type === 'match') {
							matchCount++;
						}
					} catch {
						// ignore malformed/partial line
					}
				}

				if (matchCount >= maxMatches) {
					killedForMatchLimit = true;
					child.kill();
					return;
				}

				newlineIndex = lineRemainder.indexOf('\n');
			}
		});

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
			if (killedForMatchLimit) {
				resolve(stdout);
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
			// Exit 1 = no matches. Exit 2 can be a recoverable mid-scan warning; only fail if empty.
			if (
				code !== null &&
				code > 1 &&
				stdout.length === 0 &&
				isFatalRipgrepError(stderr)
			) {
				reject(new Error(`ripgrep exited with code ${code}: ${stderr.trim()}`));
				return;
			}
			resolve(stdout);
		});
	});
}

// rg --files skips empty directories; walked separately below, without following symlinks.
const MAX_WALK_DEPTH = 200;

// Unanchored `foo` matches any depth (dirPrefix/**/foo); anchored patterns stay scoped (dirPrefix/foo).
function prefixGitignoreLine(
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

async function walkEmptyDirectories(
	cwd: string,
	rootPath: string,
	seenDirs: Set<string>,
	onEntry: (entry: ProjectEntry) => boolean | Promise<boolean>,
	signal?: AbortSignal,
): Promise<boolean> {
	// Grows as nested .gitignore files are found; prefixing keeps them scoped.
	const ig = ignore();
	ig.add(DEFAULT_IGNORE_DIRS);
	let loggedDepthCap = false;

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

		const dirPrefix = normalizePathForMatch(path.relative(cwd, absolutePath));
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

			if (ig.ignores(childRelativePath)) {
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

	return visit(rootPath, 0);
}

export async function walkProjectEntries(
	cwd: string,
	startPath: string | undefined,
	onEntry: (entry: ProjectEntry) => boolean | Promise<boolean>,
	signal?: AbortSignal,
): Promise<void> {
	const rootPath = startPath ?? cwd;
	const args = [
		'--files',
		'--hidden',
		// No --follow (symlinks could escape cwd); --no-require-git works without a repo.
		'--no-ignore-parent',
		'--no-require-git',
		'--sort',
		'path',
		...defaultIgnoreGlobs(),
		...binaryExcludeGlobs(),
		'--',
		rootPath,
	];
	const stdout = await runRipgrep(args, cwd, DEFAULT_SEARCH_TIMEOUT_MS, signal);
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
		const parts = relativeFile.split('/');

		let dirRelative = '';
		for (let index = 0; index < parts.length - 1; index++) {
			dirRelative = index === 0 ? parts[0] : `${dirRelative}/${parts[index]}`;
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
				return;
			}
		}

		const stop = await onEntry({
			absolutePath: path.join(cwd, relativeFile),
			relativePath: relativeFile,
			isDirectory: false,
		});
		if (stop) {
			return;
		}
	}

	await walkEmptyDirectories(cwd, rootPath, seenDirs, onEntry, signal);
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

	await walkProjectEntries(cwd, undefined, entry => {
		if (matchesGlob(entry.relativePath, pattern, !hasSlash)) {
			files.push(normalizePathForMatch(entry.relativePath));
			if (files.length >= maxResults) {
				truncated = true;
				return true;
			}
		}

		return false;
	});

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
		// rg sends `text` for valid UTF-8, `bytes` otherwise - absent `text` signals binary content.
		lines?: {text?: string};
	};
}

// A `match` or (`--context`) `context` line - both carry the text directly.
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

// rg already hands us the matched line's text - no file re-read, no race with concurrent edits.
function buildMatchesWithoutContext(
	rgLines: RgLine[],
	cwd: string,
	maxResults: number,
): {matches: SearchMatch[]; truncated: boolean} {
	const matches: SearchMatch[] = [];
	let truncated = false;

	for (const {file, lineNumber, text} of rgLines) {
		if (text === undefined) {
			// No `lines.text` means rg sent `lines.bytes` instead - not valid UTF-8.
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

// rg streams the surrounding context lines itself, deduped across overlapping matches.
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
				// The match line isn't valid UTF-8 (rg sent `bytes`, not `text`).
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
		// Empty pattern matches everything - rg would buffer the whole repo.
		throw new Error('Search query cannot be empty');
	}

	// No --max-count - it overshoots with --context. runRipgrep's own streamed count is the real cutoff.
	const rgMaxCount = Math.max(0, maxResults);

	const args = [
		'--json',
		'--hidden',
		'--no-ignore-parent',
		'--no-require-git',
		'--sort',
		'path',
		caseSensitive ? '--case-sensitive' : '--ignore-case',
	];
	if (wholeWord) {
		args.push('--word-regexp');
	}
	// Must precede the exclude globs: rg's `-g` is last-wins, so an include after would re-include them.
	if (include) {
		args.push('-g', include);
	}
	args.push(...defaultIgnoreGlobs(), ...binaryExcludeGlobs());
	const normalizedContextLines = Math.max(0, contextLines ?? 0);
	if (normalizedContextLines > 0) {
		args.push('--context', String(normalizedContextLines));
	}
	args.push('--regexp', query, '--', searchPath ?? cwd);

	const stdout = await runRipgrep(args, cwd, timeoutMs, signal, rgMaxCount);
	const rgLines = parseRgJsonLines(stdout);

	return normalizedContextLines > 0
		? buildMatchesWithContext(rgLines, cwd, maxResults, normalizedContextLines)
		: buildMatchesWithoutContext(rgLines, cwd, maxResults);
}
