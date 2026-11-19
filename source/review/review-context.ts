import {createTwoFilesPatch} from 'diff';
import {splitContentLines} from './review-citations';
import {normalizeCitationPath} from './review-findings';
import type {ReviewFileSnapshot, ReviewTargetSnapshot} from './review-snapshot';
import type {ReviewFoundationTools} from './review-tools';

type JsonSchemaObject = {
	type: 'object';
	properties: Record<
		string,
		{type: 'string' | 'number' | 'integer'; description: string}
	>;
	required?: string[];
	additionalProperties?: boolean;
};

export interface ReviewToolDescription {
	args: string[];
	summary: string;
	path?: string;
}

/** A read-only tool that answers questions from one pinned review snapshot. */
export interface ReviewAgentTool {
	name: string;
	description: string;
	parameters: JsonSchemaObject;
	describe: (args: Record<string, unknown>) => ReviewToolDescription;
	run: (args: Record<string, unknown>, signal?: AbortSignal) => Promise<string>;
	/** True only when this result contains an untruncated whole-file inspection. */
	coversWholeFile?: (args: Record<string, unknown>, result: string) => boolean;
}

export interface PromptDiff {
	text: string;
	includedPaths: string[];
	omittedPaths: string[];
	binaryPaths: string[];
}

const MAX_READ_LINES = 250;
const MAX_LINE_LENGTH = 400;
const MAX_DIFF_LINES = 600;
const MAX_SEARCH_RESULTS = 60;
const MAX_TREE_ENTRIES = 200;
const MAX_BLOB_BYTES = 1024 * 1024;
const MAX_LOG_COMMITS = 30;

function clipLine(line: string): string {
	return line.length > MAX_LINE_LENGTH
		? `${line.slice(0, MAX_LINE_LENGTH - 1)}…`
		: line;
}

function statusLetter(file: ReviewFileSnapshot): string {
	if (file.status === 'added') return 'A';
	if (file.status === 'deleted') return 'D';
	return 'M';
}

/** Compress sorted line numbers into `3-5, 10` style ranges. */
export function formatLineRanges(lines: number[]): string {
	const ranges: string[] = [];
	let start: number | undefined;
	let previous: number | undefined;
	for (const line of [...lines].sort((left, right) => left - right)) {
		if (start === undefined || previous === undefined) {
			start = line;
		} else if (line !== previous + 1) {
			ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
			start = line;
		}
		previous = line;
	}
	if (start !== undefined && previous !== undefined) {
		ranges.push(start === previous ? `${start}` : `${start}-${previous}`);
	}
	return ranges.join(', ');
}

export function renderFileDiff(file: ReviewFileSnapshot): string {
	if (file.isBinary) {
		return `diff --git a/${file.path} b/${file.path}\nBinary file ${file.status}; content not shown.`;
	}
	const patch = createTwoFilesPatch(
		file.status === 'added' ? '/dev/null' : `a/${file.path}`,
		file.status === 'deleted' ? '/dev/null' : `b/${file.path}`,
		file.baseContent ?? '',
		file.headContent ?? '',
		undefined,
		undefined,
		{context: 3},
	);
	const body = patch.split('\n').slice(2).join('\n').trimEnd();
	return `diff --git a/${file.path} b/${file.path}\n${body}`;
}

export function describeChangedFiles(snapshot: ReviewTargetSnapshot): string {
	if (snapshot.files.length === 0) return 'No changed files.';
	return snapshot.files
		.map(file => {
			if (file.isBinary) return `${statusLetter(file)} ${file.path} (binary)`;
			const ranges = formatLineRanges(file.lineMap.changedHeadLines);
			return ranges
				? `${statusLetter(file)} ${file.path} (changed head lines: ${ranges})`
				: `${statusLetter(file)} ${file.path} (no head lines; removals only)`;
		})
		.join('\n');
}

/**
 * Build the diff included in the finder's first prompt. Whole files are kept
 * or omitted so a partial hunk is never mistaken for the complete change; the
 * omitted paths are reported so coverage can be checked afterwards.
 */
export function buildPromptDiff(
	snapshot: ReviewTargetSnapshot,
	limits: {maxLines: number; maxChars: number},
): PromptDiff {
	const parts: string[] = [];
	const includedPaths: string[] = [];
	const omittedPaths: string[] = [];
	const binaryPaths: string[] = [];
	let lines = 0;
	let chars = 0;
	for (const file of snapshot.files) {
		if (file.isBinary) {
			binaryPaths.push(file.path);
			continue;
		}
		const diff = renderFileDiff(file);
		const diffLines = diff.split('\n').length;
		if (
			lines + diffLines > limits.maxLines ||
			chars + diff.length > limits.maxChars
		) {
			omittedPaths.push(file.path);
			continue;
		}
		parts.push(diff);
		includedPaths.push(file.path);
		lines += diffLines;
		chars += diff.length;
	}
	return {text: parts.join('\n\n'), includedPaths, omittedPaths, binaryPaths};
}

function numberLines(lines: string[], start: number, end: number): string {
	const width = String(end).length;
	const output: string[] = [];
	for (let line = start; line <= end; line++) {
		output.push(
			`${String(line).padStart(width)}: ${clipLine(lines[line - 1] ?? '')}`,
		);
	}
	return output.join('\n');
}

function positiveInteger(value: unknown): number | undefined {
	const number = typeof value === 'string' ? Number(value) : value;
	return typeof number === 'number' &&
		Number.isSafeInteger(number) &&
		number > 0
		? number
		: undefined;
}

function requirePath(value: unknown): string {
	const path =
		typeof value === 'string'
			? normalizeCitationPath(value.replace(/\/+$/, ''))
			: null;
	if (!path) {
		throw new Error(
			'path must be a repository-relative path without ".." segments.',
		);
	}
	return path;
}

function optionalPath(value: unknown): string | undefined {
	if (value === undefined || value === null || value === '' || value === '.') {
		return undefined;
	}
	return requirePath(value);
}

function decodeBlob(buffer: Buffer): string | null {
	if (buffer.includes(0)) return null;
	try {
		return new TextDecoder('utf-8', {fatal: true}).decode(buffer);
	} catch {
		return null;
	}
}

function isNoMatchExit(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /exit code 1$/.test(message.trim());
}

function readRange(
	path: string,
	content: string,
	args: Record<string, unknown>,
	label: string,
): string {
	const lines = splitContentLines(content);
	if (lines.length === 0) return `${path} (${label}) is empty.`;
	const requestedStart = positiveInteger(args.start_line) ?? 1;
	const start = Math.min(requestedStart, lines.length);
	const requestedEnd =
		positiveInteger(args.end_line) ?? start + MAX_READ_LINES - 1;
	const end = Math.min(
		lines.length,
		Math.max(start, requestedEnd),
		start + MAX_READ_LINES - 1,
	);
	const more =
		end < lines.length
			? `\n[${lines.length - end} more lines; call again with start_line=${end + 1}]`
			: '';
	return `${path} (${label}, lines ${start}-${end} of ${lines.length})\n${numberLines(lines, start, end)}${more}`;
}

function coversWholeRead(
	content: string,
	args: Record<string, unknown>,
): boolean {
	const lines = splitContentLines(content);
	return (
		(positiveInteger(args.start_line) ?? 1) === 1 &&
		(positiveInteger(args.end_line) ?? MAX_READ_LINES) >= lines.length &&
		lines.length <= MAX_READ_LINES &&
		lines.every(line => line.length <= MAX_LINE_LENGTH)
	);
}

/**
 * Create the read-only tools the review agents may call. Every answer comes
 * from the pinned snapshot or the pinned head commit's Git objects, never from
 * whatever happens to be checked out, so a remote PR is inspected at the exact
 * revision whose diff is being reviewed.
 */
export function createReviewContextTools(
	snapshot: ReviewTargetSnapshot,
	tools: ReviewFoundationTools,
): ReviewAgentTool[] {
	const changed = new Map(snapshot.files.map(file => [file.path, file]));
	const headOid = snapshot.headOid;
	const headLabel =
		snapshot.headKind === 'working-tree'
			? 'working tree'
			: `head ${headOid.slice(0, 12)}`;

	const readHeadObject = async (
		path: string,
		signal?: AbortSignal,
	): Promise<
		{kind: 'blob'; content: string | null} | {kind: 'tree'; entries: string[]}
	> => {
		const objectName = `${headOid}:${path}`;
		const type = await tools.execGit(['cat-file', '-t', objectName], signal);
		if (type === 'tree') {
			const listing = await tools.execGit(
				['ls-tree', '--name-only', objectName],
				signal,
			);
			return {kind: 'tree', entries: listing.split('\n').filter(Boolean)};
		}
		if (type !== 'blob') throw new Error(`${path} is not a file.`);
		const size = Number(
			await tools.execGit(['cat-file', '-s', objectName], signal),
		);
		if (!Number.isSafeInteger(size) || size > MAX_BLOB_BYTES) {
			throw new Error(`${path} is larger than the 1 MiB read limit.`);
		}
		const bytes = await tools.execGitBuffer(
			['cat-file', 'blob', objectName],
			signal,
		);
		return {kind: 'blob', content: decodeBlob(bytes)};
	};

	return [
		{
			name: 'review_changed_files',
			description:
				'List every file changed in the reviewed scope with its status (A added, M modified, D deleted) and the changed line numbers in the reviewed head.',
			parameters: {type: 'object', properties: {}, additionalProperties: false},
			describe: () => ({args: [], summary: 'Listing changed files'}),
			run: async () => describeChangedFiles(snapshot),
		},
		{
			name: 'review_diff',
			description:
				'Show the unified diff for one changed file in the reviewed scope.',
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Repository-relative path of a changed file.',
					},
				},
				required: ['path'],
				additionalProperties: false,
			},
			describe: args => {
				const path = typeof args.path === 'string' ? args.path : '';
				return {args: [path], summary: `Reading the diff of ${path}`, path};
			},
			run: async args => {
				const path = requirePath(args.path);
				const file = changed.get(path);
				if (!file) {
					return `Error: ${path} is not changed in the reviewed scope. Use review_changed_files to list changed files.`;
				}
				const lines = renderFileDiff(file).split('\n');
				if (lines.length <= MAX_DIFF_LINES) return lines.join('\n');
				return `${lines.slice(0, MAX_DIFF_LINES).join('\n')}\n[diff truncated after ${MAX_DIFF_LINES} of ${lines.length} lines; use review_read_file with start_line to read the rest of the file]`;
			},
			coversWholeFile: (args, result) => {
				const file = changed.get(requirePath(args.path));
				return !!file && !file.isBinary && result === renderFileDiff(file);
			},
		},
		{
			name: 'review_read_file',
			description: `Read a file (or list a directory) exactly as it exists in the reviewed ${headLabel}, with line numbers. Returns at most ${MAX_READ_LINES} lines per call; use start_line and end_line for more.`,
			parameters: {
				type: 'object',
				properties: {
					path: {
						type: 'string',
						description: 'Repository-relative path of a file or directory.',
					},
					start_line: {
						type: 'number',
						description: 'Optional first line to read (1-indexed).',
					},
					end_line: {
						type: 'number',
						description: 'Optional last line to read (inclusive).',
					},
				},
				required: ['path'],
				additionalProperties: false,
			},
			describe: args => {
				const path = typeof args.path === 'string' ? args.path : '';
				const range =
					args.start_line !== undefined
						? `:${String(args.start_line)}${args.end_line !== undefined ? `-${String(args.end_line)}` : ''}`
						: '';
				return {
					args: [`${path}${range}`],
					summary: `Reading ${path}${range}`,
					path,
				};
			},
			run: async (args, signal) => {
				const path = requirePath(args.path);
				const file = changed.get(path);
				if (file) {
					if (file.isBinary) return `${path} is a binary file.`;
					if (file.headContent === null) {
						return file.baseContent === null
							? `${path} has no readable content.`
							: readRange(
									path,
									file.baseContent,
									args,
									'deleted in the reviewed head; showing the base version',
								);
					}
					return readRange(path, file.headContent, args, headLabel);
				}
				try {
					const object = await readHeadObject(path, signal);
					if (object.kind === 'tree') {
						const entries = object.entries.slice(0, MAX_TREE_ENTRIES);
						const more =
							object.entries.length > entries.length
								? `\n[${object.entries.length - entries.length} more entries]`
								: '';
						return `${path}/ (directory in the reviewed ${headLabel})\n${entries.join('\n')}${more}`;
					}
					if (object.content === null) return `${path} is a binary file.`;
					return readRange(path, object.content, args, headLabel);
				} catch (error) {
					if (signal?.aborted) throw error;
					return `Error: ${path} could not be read from the reviewed ${headLabel}.`;
				}
			},
			coversWholeFile: args => {
				const file = changed.get(requirePath(args.path));
				const content = file?.headContent ?? file?.baseContent;
				return (
					!!file &&
					!file.isBinary &&
					content !== null &&
					content !== undefined &&
					coversWholeRead(content, args)
				);
			},
		},
		{
			name: 'review_search',
			description: `Search for a literal string (not a regular expression) across the reviewed ${headLabel}. Returns path:line: text matches.`,
			parameters: {
				type: 'object',
				properties: {
					pattern: {
						type: 'string',
						description: 'Literal text to find, 1-200 characters.',
					},
					path: {
						type: 'string',
						description:
							'Optional repository-relative file or directory to limit the search.',
					},
				},
				required: ['pattern'],
				additionalProperties: false,
			},
			describe: args => {
				const pattern = typeof args.pattern === 'string' ? args.pattern : '';
				const path = typeof args.path === 'string' ? args.path : '';
				return {
					args: path ? [pattern, path] : [pattern],
					summary: `Searching for "${pattern}"${path ? ` in ${path}` : ''}`,
				};
			},
			run: async (args, signal) => {
				const pattern = typeof args.pattern === 'string' ? args.pattern : '';
				if (!pattern || pattern.length > 200 || /[\r\n\0]/.test(pattern)) {
					return 'Error: pattern must be 1-200 characters on a single line.';
				}
				const scopePath = optionalPath(args.path);
				const inScope = (path: string) =>
					!scopePath || path === scopePath || path.startsWith(`${scopePath}/`);
				const results: string[] = [];
				for (const file of snapshot.files) {
					if (!inScope(file.path) || file.headContent === null) continue;
					splitContentLines(file.headContent).forEach((line, index) => {
						if (line.includes(pattern)) {
							results.push(
								`${file.path}:${index + 1}: ${clipLine(line.trim())}`,
							);
						}
					});
				}
				const grepArgs = [
					'grep',
					'-n',
					'-I',
					'-F',
					'--no-color',
					'-e',
					pattern,
					headOid,
					'--',
					...(scopePath ? [`:(literal)${scopePath}`] : []),
				];
				let output = '';
				try {
					output = await tools.execGit(grepArgs, signal);
				} catch (error) {
					if (signal?.aborted) throw error;
					if (!isNoMatchExit(error)) {
						return 'Error: the search could not be run against the reviewed revision.';
					}
				}
				const prefix = `${headOid}:`;
				for (const line of output.split('\n')) {
					if (!line.startsWith(prefix)) continue;
					const rest = line.slice(prefix.length);
					const match = rest.match(/^(.*?):(\d+):(.*)$/);
					if (!match?.[1] || changed.has(match[1])) continue;
					results.push(
						`${match[1]}:${match[2]}: ${clipLine((match[3] ?? '').trim())}`,
					);
				}
				if (results.length === 0) return `No matches for "${pattern}".`;
				const shown = results.slice(0, MAX_SEARCH_RESULTS);
				const more =
					results.length > shown.length
						? `\n[${results.length - shown.length} more matches; narrow the search with path]`
						: '';
				return `${shown.join('\n')}${more}`;
			},
		},
		{
			name: 'review_log',
			description:
				'List the commits included in the reviewed scope (short hash, author, subject).',
			parameters: {type: 'object', properties: {}, additionalProperties: false},
			describe: () => ({args: [], summary: 'Listing commits in scope'}),
			run: async (_args, signal) => {
				if (
					snapshot.headKind === 'working-tree' ||
					snapshot.baseOid === snapshot.headOid
				) {
					return 'This scope has no commits; it reviews uncommitted working-tree changes.';
				}
				const log = await tools.execGit(
					[
						'log',
						'--no-color',
						`--max-count=${MAX_LOG_COMMITS}`,
						'--format=%h %an: %s',
						`${snapshot.baseOid}..${snapshot.headOid}`,
					],
					signal,
				);
				return log.trim() || 'No commits in scope.';
			},
		},
	];
}
