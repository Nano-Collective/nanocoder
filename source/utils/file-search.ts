import {lstat, readdir, readFile} from 'node:fs/promises';
import path from 'node:path';

import {BINARY_FILE_EXTENSIONS} from '@/constants';
import {loadGitignore} from '@/utils/gitignore-loader';

const MAX_CONTEXT_CONTENT_LENGTH = 1500;
const MAX_MATCH_CONTENT_LENGTH = 300;
const DEFAULT_SEARCH_TIMEOUT_MS = 30_000;

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

function escapeRegexChar(char: string): string {
	return /[|\\{}()[\]^$+?.]/.test(char) ? `\\${char}` : char;
}

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

function globToRegExpSource(pattern: string): string {
	let source = '';

	for (let index = 0; index < pattern.length; index++) {
		const current = pattern[index];
		const next = pattern[index + 1];

		if (current === '*') {
			if (next === '*') {
				const afterNext = pattern[index + 2];
				if (afterNext === '/') {
					source += '(?:.*/)?';
					index += 2;
				} else {
					source += '.*';
					index += 1;
				}
			} else {
				source += '[^/]*';
			}
			continue;
		}

		if (current === '?') {
			source += '[^/]';
			continue;
		}

		if (current === '/') {
			source += '/';
			continue;
		}

		source += escapeRegexChar(current);
	}

	return source;
}

function buildGlobRegexes(pattern: string): RegExp[] {
	const normalizedPattern = normalizePathForMatch(pattern);
	return expandBraces(normalizedPattern).map(
		expanded => new RegExp(`^${globToRegExpSource(expanded)}$`),
	);
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
	return buildGlobRegexes(pattern).some(regex => regex.test(target));
}

function isIgnoredByBinaryHeuristics(
	filePath: string,
	content: string,
): boolean {
	const ext = path.extname(filePath).toLowerCase();
	if (BINARY_FILE_EXTENSIONS.has(ext)) {
		return true;
	}

	return content.includes('\0');
}

function formatMatchContent(content: string, maxLength: number): string {
	if (content.length <= maxLength) {
		return content;
	}
	return `${content.slice(0, maxLength)}…`;
}

function buildSearchRegex(
	query: string,
	caseSensitive: boolean,
	wholeWord: boolean,
): RegExp {
	const flags = caseSensitive ? 'g' : 'gi';
	const source = wholeWord ? `\\b(?:${query})\\b` : query;
	return new RegExp(source, flags);
}

export async function walkProjectEntries(
	cwd: string,
	startPath: string | undefined,
	onEntry: (entry: ProjectEntry) => boolean | Promise<boolean>,
	signal?: AbortSignal,
): Promise<void> {
	const ig = loadGitignore(cwd);
	const rootPath = startPath ?? cwd;
	await lstat(rootPath);

	const checkAborted = () => {
		if (signal?.aborted) {
			throw signal.reason ?? new Error('Walk aborted');
		}
	};

	const visit = async (
		absolutePath: string,
		relativePath: string,
	): Promise<boolean> => {
		checkAborted();
		if (relativePath && ig.ignores(normalizePathForMatch(relativePath))) {
			return false;
		}

		const stats = await lstat(absolutePath);
		const isDirectory = stats.isDirectory();
		const isSymlink = stats.isSymbolicLink();

		if (relativePath) {
			const shouldStop = await onEntry({
				absolutePath,
				relativePath,
				isDirectory,
			});
			if (shouldStop) {
				return true;
			}
		}

		if (!isDirectory || isSymlink) {
			return false;
		}

		let children = await readdir(absolutePath, {withFileTypes: true});
		children = children.sort((a, b) => a.name.localeCompare(b.name));

		for (const child of children) {
			const childAbsolutePath = path.join(absolutePath, child.name);
			const childRelativePath = relativePath
				? path.join(relativePath, child.name)
				: child.name;

			if (await visit(childAbsolutePath, childRelativePath)) {
				return true;
			}
		}

		return false;
	};

	const rootRelativePath = path.relative(cwd, rootPath);
	await visit(rootPath, rootRelativePath === '' ? '' : rootRelativePath);
}

export async function findMatchingPaths(
	pattern: string,
	cwd: string,
	maxResults: number,
): Promise<{files: string[]; truncated: boolean}> {
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
): Promise<{matches: SearchMatch[]; truncated: boolean}> {
	const matches: SearchMatch[] = [];
	let truncated = false;
	const regex = buildSearchRegex(query, caseSensitive, wholeWord ?? false);
	const hasContext = contextLines !== undefined && contextLines > 0;
	const normalizedContextLines = Math.max(0, contextLines ?? 0);
	const includeHasSlash = include
		? normalizePathForMatch(include).includes('/')
		: false;

	const controller = new AbortController();
	const timeoutError = new SearchTimeoutError(timeoutMs);
	const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);

	try {
		await walkProjectEntries(
			cwd,
			searchPath,
			async entry => {
				if (entry.isDirectory) {
					return false;
				}

				if (
					include &&
					!matchesGlob(entry.relativePath, include, !includeHasSlash)
				) {
					return false;
				}

				let content: string;
				try {
					content = await readFile(entry.absolutePath, 'utf-8');
				} catch {
					return false;
				}

				if (isIgnoredByBinaryHeuristics(entry.relativePath, content)) {
					return false;
				}

				const lines = content.split(/\r?\n/);

				for (let index = 0; index < lines.length; index++) {
					const currentLine = lines[index] ?? '';

					regex.lastIndex = 0;
					if (!regex.test(currentLine)) {
						continue;
					}

					const lineNumber = index + 1;
					let matchContent = currentLine.trim();

					if (hasContext) {
						const start = Math.max(0, index - normalizedContextLines);
						const end = Math.min(
							lines.length - 1,
							index + normalizedContextLines,
						);
						const contextContent = lines
							.slice(start, end + 1)
							.map((line, offset) => `${start + offset + 1}: ${line}`)
							.join('\n');
						matchContent = formatMatchContent(
							contextContent,
							MAX_CONTEXT_CONTENT_LENGTH,
						);
					} else {
						matchContent = formatMatchContent(
							matchContent,
							MAX_MATCH_CONTENT_LENGTH,
						);
					}

					matches.push({
						file: normalizePathForMatch(entry.relativePath),
						line: lineNumber,
						content: matchContent,
					});

					if (matches.length >= maxResults) {
						truncated = true;
						return true;
					}
				}

				return false;
			},
			controller.signal,
		);
	} finally {
		clearTimeout(timer);
	}

	return {matches, truncated};
}
