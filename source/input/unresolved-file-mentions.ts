import {FILE_EXTENSION_TO_LANGUAGE} from '@/constants';
import {getAllFiles} from './file-autocomplete';
import {loadFileContent} from './file-content-loader';

interface ParsedFileMention {
	/** The exact text in the prompt, e.g. "@src/app.tsx:10-20". */
	rawText: string;
	/** The path without the leading "@" or the line range. */
	filePath: string;
	lineRange?: {start: number; end?: number};
	startIndex: number;
	endIndex: number;
}

export interface UnresolvedFileMention {
	rawText: string;
	filePath: string;
	/** Short, user-facing reason the file could not be attached. */
	reason: string;
	/** A close project path, when one can be suggested. */
	suggestion?: string;
}

// A mention starts at the beginning of the prompt or after whitespace. That
// deliberately excludes the "@" in an email address ("user@example.com") and
// the "@" inside an existing placeholder ("[@src/app.tsx]").
const MENTION_REGEX = /(^|\s)@([^\s@]+)/g;

// Punctuation that commonly trails a mention in prose, e.g. "@src/app.tsx.".
const TRAILING_PUNCTUATION = /[.,;!?)\]}'"]+$/;

// Extensions we accept on a bare mention. Anything else is treated as prose:
// an annotation ("@pytest.mark.skip"), a scoped package ("@angular/core.module")
// or a version ("@1.2.3") must not raise a "could not attach" warning.
const KNOWN_EXTENSIONS = new Set([
	...Object.keys(FILE_EXTENSION_TO_LANGUAGE),
	// Common text and data files with no highlight.js grammar.
	'.txt',
	'.csv',
	'.tsv',
	'.log',
	'.env',
	'.cfg',
	'.conf',
	'.properties',
	'.bat',
	'.ps1',
	'.cmd',
	'.gradle',
	'.sln',
	'.csproj',
	'.ipynb',
	'.lock',
	'.vue',
	'.svelte',
	'.astro',
	'.dart',
	'.tf',
	'.hcl',
	'.nix',
	'.proto',
]);

/**
 * Extract every file-like @mention from a prompt. Existing placeholders
 * ("[@src/app.tsx]") are ignored, as are bare handles such as "@media" that do
 * not look like paths, and anything inside inline code or a fenced block.
 *
 * A mention needs a `/`-separated path with a known extension, a dotfile
 * ("@.env") or a directory separator at the end ("@src/"). Bare names without
 * an extension ("@Makefile", "@LICENSE", "@src/utils") are deliberately left
 * alone: they are too close to prose to warn about.
 */
export function parseRawFileMentions(text: string): ParsedFileMention[] {
	const mentions: ParsedFileMention[] = [];
	const searchable = maskCodeSpans(text);
	MENTION_REGEX.lastIndex = 0;

	for (const match of searchable.matchAll(MENTION_REGEX)) {
		const prefix = match[1] ?? '';
		const rawToken = match[2] ?? '';
		const startIndex = (match.index ?? 0) + prefix.length;
		const token = rawToken.replace(TRAILING_PUNCTUATION, '');

		if (!token) {
			continue;
		}

		const rangeMatch = token.match(/:(\d+)(?:-(\d+))?$/);
		const filePath = rangeMatch ? token.slice(0, rangeMatch.index) : token;

		if (!looksLikeFilePath(filePath)) {
			continue;
		}

		const mention: ParsedFileMention = {
			rawText: `@${token}`,
			filePath,
			startIndex,
			endIndex: startIndex + token.length + 1,
		};

		if (rangeMatch) {
			const start = Number.parseInt(rangeMatch[1] ?? '', 10);
			const end = rangeMatch[2]
				? Number.parseInt(rangeMatch[2], 10)
				: undefined;

			if (start > 0 && (!end || end >= start)) {
				mention.lineRange = {start, end};
			}
		}

		mentions.push(mention);
	}

	return mentions;
}

/**
 * Blank out inline code spans and fenced code blocks, preserving offsets, so a
 * path quoted inside backticks is not treated as a mention.
 */
function maskCodeSpans(text: string): string {
	const blank = (match: string) => match.replace(/[^\n]/g, ' ');
	return text.replace(/```[\s\S]*?```/g, blank).replace(/`[^`\n]*`/g, blank);
}

function looksLikeFilePath(filePath: string): boolean {
	if (!filePath) return false;
	// A trailing separator is an explicit directory mention ("@src/").
	if (filePath.endsWith('/') || filePath.endsWith('\\')) return true;

	const name = filePath.split(/[\\/]/).pop() ?? '';

	// A dotfile at any depth ("@.env", "@.env.local") is a real path. A name of
	// "." or ".." is a directory, not a file.
	if (name.startsWith('.') && name.length > 1) {
		return name !== '..';
	}

	// Dotted versions ("@1.2.3", "@2.0") are prose, not paths.
	if (/^\d+(?:\.\d+)+$/.test(name)) return false;

	const dot = name.lastIndexOf('.');
	// Require an extension-like final segment. That keeps scoped package names
	// such as "@types/node" and bare handles such as "@media" out of mention
	// warnings, while covering the typo/rename/wrong-case cases this is for.
	if (dot <= 0) return false;

	const extension = name.slice(dot).toLowerCase();
	if (KNOWN_EXTENSIONS.has(extension)) return true;

	// Catch a mistyped extension ("@src/app.tsxx") without accepting arbitrary
	// dotted words. Extensions shorter than three characters collide with too
	// many annotation names, so only longer ones get the near-miss check.
	if (extension.length < 4) return false;
	for (const known of KNOWN_EXTENSIONS) {
		if (Math.abs(known.length - extension.length) > 1) continue;
		if (editDistance(extension, known) <= 1) return true;
	}

	return false;
}

/**
 * Find the @mentions in a prompt that would not attach as files. Mentions that
 * load successfully are left alone - they stay plain text, as they always
 * have - but a missing, unreadable or non-file path is reported instead of
 * disappearing silently.
 */
export async function findUnresolvedFileMentions(
	text: string,
	cwd: string = process.cwd(),
): Promise<UnresolvedFileMention[]> {
	const unresolved: UnresolvedFileMention[] = [];

	for (const mention of parseRawFileMentions(text)) {
		const result = await loadFileContent(mention.filePath, mention.lineRange);
		if (result.success) continue;

		const reason = describeFailure(result.error);
		const suggestion =
			reason === 'file not found'
				? await suggestClosestFile(mention.filePath, cwd)
				: undefined;

		unresolved.push({
			rawText: mention.rawText,
			filePath: mention.filePath,
			reason,
			suggestion,
		});
	}

	return unresolved;
}

function describeFailure(error: string | undefined): string {
	if (!error) return 'could not be read';
	if (error === 'Path is not a file') return 'is a directory, not a file';
	if (error === 'Failed to read file (might be binary)') {
		return 'could not be read';
	}
	if (/ENOENT|no such file/i.test(error)) return 'file not found';
	if (/EACCES|EPERM|permission denied/i.test(error)) return 'permission denied';
	return 'could not be read';
}

async function suggestClosestFile(
	filePath: string,
	cwd: string,
): Promise<string | undefined> {
	const wanted = filePath.replace(/\\/g, '/').toLowerCase();
	const wantedExtension = extensionOf(wanted);
	const files = await getAllFiles(cwd);
	let best:
		| {path: string; distance: number; sameExtension: boolean}
		| undefined;

	for (const file of files) {
		// Normalization only swaps separators and folds case, so the length is
		// the same either way. Use the raw length to reject most candidates
		// before allocating a normalized copy.
		const lengthDelta = Math.abs(file.length - wanted.length);
		if (lengthDelta > allowedDistance(wanted.length, file.length)) continue;

		const candidate = file.replace(/\\/g, '/').toLowerCase();
		// The exact path would have loaded; only near-misses are suggestions.
		if (candidate === wanted) continue;

		// The edit distance can never be smaller than the length difference, so
		// the filter above drops most candidates before the O(n*m) matrix. This
		// keeps the scan cheap in repositories with tens of thousands of files.
		const distance = editDistance(wanted, candidate);
		const allowed = allowedDistance(wanted.length, candidate.length);
		if (distance > allowed) continue;

		// On a tie, prefer a file with the same extension: a typo is far more
		// often in the name than in the extension.
		const sameExtension = extensionOf(candidate) === wantedExtension;
		if (
			!best ||
			distance < best.distance ||
			(distance === best.distance && sameExtension && !best.sameExtension)
		) {
			best = {path: file, distance, sameExtension};
		}
	}

	return best?.path;
}

function allowedDistance(
	wantedLength: number,
	candidateLength: number,
): number {
	return Math.max(2, Math.floor(Math.max(wantedLength, candidateLength) * 0.3));
}

function extensionOf(path: string): string {
	const name = path.split('/').pop() ?? '';
	const dot = name.lastIndexOf('.');
	return dot > 0 ? name.slice(dot) : '';
}

function editDistance(a: string, b: string): number {
	let previous = Array.from({length: b.length + 1}, (_, index) => index);

	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			current[j] = Math.min(
				(current[j - 1] ?? 0) + 1,
				(previous[j] ?? 0) + 1,
				(previous[j - 1] ?? 0) + cost,
			);
		}
		previous = current;
	}

	return previous[b.length] ?? 0;
}

/** One-line warning shown above the prompt. */
export function formatUnresolvedMentionWarning(
	mentions: UnresolvedFileMention[],
): string {
	const details = mentions.map(mention => {
		const suggestion = mention.suggestion
			? ` (did you mean ${mention.suggestion}?)`
			: '';
		return `${mention.rawText}: ${mention.reason}${suggestion}`;
	});
	return `Could not attach ${details.join('; ')}. Press Enter again to send anyway.`;
}

/**
 * Note prefixed to the model message when the user sends anyway, so the model
 * does not assume it has seen files that were never attached.
 */
export function buildUnresolvedMentionNote(
	mentions: UnresolvedFileMention[],
): string {
	return [
		'Note: these @file mentions could not be attached, so their contents are NOT included in this message:',
		...mentions.map(mention => `- ${mention.rawText}: ${mention.reason}`),
		'Do not claim to have read them; ask the user for the correct path if needed.',
	].join('\n');
}
