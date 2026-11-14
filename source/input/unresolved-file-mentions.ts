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

/**
 * Extract every file-like @mention from a prompt. Existing placeholders
 * ("[@src/app.tsx]") are ignored, as are bare handles such as "@media" that do
 * not look like paths.
 */
export function parseRawFileMentions(text: string): ParsedFileMention[] {
	const mentions: ParsedFileMention[] = [];
	MENTION_REGEX.lastIndex = 0;

	for (const match of text.matchAll(MENTION_REGEX)) {
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

function looksLikeFilePath(filePath: string): boolean {
	if (!filePath) return false;
	// A trailing separator is an explicit directory mention ("@src/").
	if (filePath.endsWith('/') || filePath.endsWith('\\')) return true;
	// Require an extension-like final segment. That keeps scoped package names
	// such as "@types/node" and bare handles such as "@media" out of mention
	// warnings, while covering the typo/rename/wrong-case cases this is for.
	const name = filePath.split(/[\\/]/).pop() ?? '';
	return name.includes('.') && name !== '.' && name !== '..';
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
	const files = await getAllFiles(cwd);
	let best: {path: string; distance: number} | undefined;

	for (const file of files) {
		const candidate = file.replace(/\\/g, '/').toLowerCase();
		// The exact path would have loaded; only near-misses are suggestions.
		if (candidate === wanted) continue;

		const distance = editDistance(wanted, candidate);
		const allowed = Math.max(
			2,
			Math.floor(Math.max(wanted.length, candidate.length) * 0.3),
		);
		if (distance > allowed) continue;
		if (!best || distance < best.distance) {
			best = {path: file, distance};
		}
	}

	return best?.path;
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
