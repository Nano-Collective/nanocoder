/** Deterministic evidence for failed edits. Suggestions never modify a file. */
export interface EditRecoveryPayload {
	version: 1;
	reason: 'search_not_found';
	path: string;
	blockNumber?: number;
	status: 'candidate_found' | 'ambiguous' | 'no_candidate' | 'budget_exceeded';
	candidates: EditRecoveryCandidate[];
	nextAction: string;
}

interface EditRecoveryCandidate {
	startLine: number;
	endLine: number;
	matchKind: 'whitespace' | 'blank_lines' | 'line_endings' | 'fuzzy';
	actualText?: string;
	differences: string[];
	truncated: boolean;
}

// Reserve room for the tool's error heading and validation prefix.
const MAX_PAYLOAD_CHARS = 3600;
const MAX_FILE_CHARS = 1_000_000;
const MAX_SEARCH_CHARS = 8000;
const MAX_SEARCH_LINES = 40;
const MAX_COMPARISONS = 100_000;

function lineSimilarity(a: string, b: string): number {
	if (a === b) return 1;
	const wordsA = new Set(a.match(/[\w$]+|[^\w\s]/g));
	const wordsB = new Set(b.match(/[\w$]+|[^\w\s]/g));
	let common = 0;
	for (const word of wordsA) if (wordsB.has(word)) common++;
	return common / Math.max(1, wordsA.size + wordsB.size - common);
}

export function buildEditRecovery(
	path: string,
	fileContent: string,
	searchText: string,
	blockNumber?: number,
): EditRecoveryPayload {
	const payload: EditRecoveryPayload = {
		version: 1,
		reason: 'search_not_found',
		path: path.length > 300 ? `${path.slice(0, 297)}...` : path,
		...(blockNumber === undefined ? {} : {blockNumber}),
		status: 'no_candidate',
		candidates: [],
		nextAction:
			'Read the relevant file range and copy the exact search text before retrying.',
	};
	if (
		fileContent.length > MAX_FILE_CHARS ||
		searchText.length > MAX_SEARCH_CHARS ||
		searchText.split('\n').length > MAX_SEARCH_LINES
	) {
		payload.status = 'budget_exceeded';
		return payload;
	}
	// Short/generic searches cannot establish a useful target reliably.
	if ((searchText.match(/[\w$]/g)?.length ?? 0) < 8) return payload;
	const lines = fileContent.split('\n');
	const searchLines = searchText.split('\n');
	const wanted = searchLines
		.filter(line => line.trim())
		.map(line => line.trim());
	if (wanted.length === 0) return payload;
	const originalWanted = searchLines.filter(line => line.trim());
	const nonblank = lines.flatMap((line, index) =>
		line.trim() ? [{text: line.trim(), index}] : [],
	);
	const leadingBlanks = searchLines.findIndex(line => line.trim());
	let trailingBlanks = 0;
	for (let i = searchLines.length - 1; i >= 0 && !searchLines[i].trim(); i--)
		trailingBlanks++;
	const ranked: Array<{score: number; candidate: EditRecoveryCandidate}> = [];
	let comparisons = 0;
	let fuzzyComparisons = 0;
	for (let start = 0; start + wanted.length <= nonblank.length; start++) {
		let score = 0;
		let exact = 0;
		let plausible = true;
		for (let i = 0; i < wanted.length; i++) {
			if (++comparisons > MAX_COMPARISONS) {
				payload.status = 'budget_exceeded';
				return payload;
			}
			const actual = nonblank[start + i].text;
			if (actual.length > MAX_SEARCH_CHARS) {
				plausible = false;
				break;
			}
			// Bound expensive token comparisons separately from linear equality checks.
			let similarity = actual === wanted[i] ? 1 : 0;
			if (
				similarity === 0 &&
				actual.length <= 512 &&
				wanted[i].length <= 512 &&
				fuzzyComparisons < 2000
			) {
				fuzzyComparisons++;
				similarity = lineSimilarity(wanted[i], actual);
			}
			if (actual === wanted[i]) exact++;
			if (similarity < 0.6) {
				plausible = false;
				break;
			}
			score += similarity;
		}
		score /= wanted.length;
		const normalizedMatch = exact === wanted.length;
		if (!plausible || (!normalizedMatch && (exact < 2 || score < 0.85)))
			continue;
		const first = nonblank[start].index;
		const last = nonblank[start + wanted.length - 1].index;
		let from = first;
		let to = last;
		for (
			let i = 0;
			i < leadingBlanks && from > 0 && !lines[from - 1].trim();
			i++
		)
			from--;
		for (
			let i = 0;
			i < trailingBlanks && to + 1 < lines.length && !lines[to + 1].trim();
			i++
		)
			to++;
		const oversized = to - from + 1 > MAX_SEARCH_LINES;
		const actualText = oversized ? '' : lines.slice(from, to + 1).join('\n');
		const differences: string[] = [];
		const blankDifference =
			to - from + 1 - wanted.length - (searchLines.length - wanted.length);
		if (blankDifference !== 0)
			differences.push(
				`Current block has ${Math.abs(blankDifference)} ${blankDifference > 0 ? 'more' : 'fewer'} blank line(s) than the search text.`,
			);
		if (
			normalizedMatch &&
			actualText.replace(/\r\n/g, '\n') === searchText.replace(/\r\n/g, '\n')
		) {
			differences.push('Line endings differ (LF versus CRLF).');
		} else if (normalizedMatch) {
			const whitespaceLines = wanted.flatMap((_, index) => {
				const fileLine = nonblank[start + index].index;
				return lines[fileLine].replace(/\r$/, '') !==
					originalWanted[index].replace(/\r$/, '')
					? [fileLine + 1]
					: [];
			});
			if (whitespaceLines.length > 0)
				differences.push(
					`Leading/trailing whitespace differs at file line(s) ${whitespaceLines.slice(0, 3).join(', ')}${whitespaceLines.length > 3 ? ', ...' : ''}.`,
				);
			differences.push(
				'Leading/trailing whitespace or blank-line placement differs; preserve the exact current text.',
			);
		} else {
			differences.push(
				'Non-whitespace text differs; verify this is the intended target before retrying.',
			);
		}
		const candidate: EditRecoveryCandidate = {
			startLine: from + 1,
			endLine: to + 1,
			matchKind: !normalizedMatch
				? 'fuzzy'
				: blankDifference !== 0
					? 'blank_lines'
					: differences[0]?.startsWith('Line endings')
						? 'line_endings'
						: 'whitespace',
			...(oversized ? {} : {actualText}),
			differences,
			truncated: oversized,
		};
		ranked.push({score, candidate});
		// Only the best three are needed to detect ambiguity and return two.
		ranked.sort(
			(a, b) =>
				b.score - a.score || a.candidate.startLine - b.candidate.startLine,
		);
		if (ranked.length > 3) ranked.pop();
	}
	if (ranked.length === 0) return payload;
	const best = ranked[0].score;
	const matches = ranked.filter(entry => best - entry.score <= 0.05);
	if (best < 1 && fuzzyComparisons >= 2000) {
		payload.status = 'budget_exceeded';
		return payload;
	}
	payload.status = matches.length > 1 ? 'ambiguous' : 'candidate_found';
	payload.candidates = matches.slice(0, 2).map(entry => entry.candidate);
	payload.nextAction =
		payload.status === 'ambiguous'
			? 'Multiple plausible targets exist. Read these ranges and add surrounding context to make the search unique.'
			: 'Verify the suggested target, then retry using actualText as the exact search text. No fuzzy replacement was applied.';
	for (const candidate of payload.candidates) {
		if (
			candidate.endLine - candidate.startLine + 1 > MAX_SEARCH_LINES ||
			JSON.stringify(payload).length > MAX_PAYLOAD_CHARS
		) {
			delete candidate.actualText;
			candidate.truncated = true;
			payload.nextAction =
				'Read the candidate line ranges; omitted text is not a complete replacement string.';
		}
	}
	return payload;
}

/** JSON travels in the error message through existing validation/runtime paths. */
export class EditRecoveryError extends Error {
	readonly recovery: EditRecoveryPayload;

	constructor(
		message: string,
		path: string,
		content: string,
		search: string,
		blockNumber?: number,
	) {
		const recovery = buildEditRecovery(path, content, search, blockNumber);
		super(
			`${message}\nNo changes were written. Edit recovery evidence (JSON):\n${JSON.stringify(recovery)}`,
		);
		this.name = 'EditRecoveryError';
		this.recovery = recovery;
	}
}
