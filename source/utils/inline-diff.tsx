import {createRequire} from 'node:module';

export interface DiffSegment {
	text: string;
	type: 'unchanged' | 'added' | 'removed';
}

// The `diff` package is ~30 modules when loaded and is only needed by the
// string-replace tool's preview formatter, which runs at tool-confirmation
// time — never at startup. We lazy-load the CJS entry via `createRequire`
// so the library only hits the module graph the first time the preview
// actually renders. Must stay sync because React rendering is sync.
const require = createRequire(import.meta.url);

type DiffChange = {value: string; added?: boolean; removed?: boolean};
type DiffModule = {
	diffWordsWithSpace: (oldText: string, newText: string) => DiffChange[];
};
let diffLib: DiffModule | null = null;
function loadDiffLib(): DiffModule {
	if (!diffLib) {
		diffLib = require('diff') as DiffModule;
	}
	return diffLib;
}

/**
 * Compute inline diff segments between two strings.
 * Uses word-level diffing for more readable results.
 */
export function computeInlineDiff(
	oldText: string,
	newText: string,
): DiffSegment[] {
	const {diffWordsWithSpace} = loadDiffLib();
	const changes = diffWordsWithSpace(oldText, newText);
	const segments: DiffSegment[] = [];

	for (const change of changes) {
		if (change.added) {
			segments.push({text: change.value, type: 'added'});
		} else if (change.removed) {
			segments.push({text: change.value, type: 'removed'});
		} else {
			segments.push({text: change.value, type: 'unchanged'});
		}
	}

	return segments;
}

/**
 * Check if two lines are similar enough to show as an inline diff.
 * Returns true if the lines share significant common content.
 */
export function areLinesSimlar(oldLine: string, newLine: string): boolean {
	// If either is empty, they're not similar for inline display
	if (!oldLine.trim() && !newLine.trim()) return true; // Both empty/whitespace
	if (!oldLine.trim() || !newLine.trim()) return false;

	// Use LCS-like heuristic: count common characters
	const oldTrimmed = oldLine.trim();
	const newTrimmed = newLine.trim();

	// Calculate similarity using word overlap
	const oldWords = new Set(oldTrimmed.split(/\s+/).filter(Boolean));
	const newWords = new Set(newTrimmed.split(/\s+/).filter(Boolean));

	if (oldWords.size === 0 && newWords.size === 0) return true;
	if (oldWords.size === 0 || newWords.size === 0) return false;

	let commonWords = 0;
	for (const word of oldWords) {
		if (newWords.has(word)) commonWords++;
	}

	const similarity = commonWords / Math.max(oldWords.size, newWords.size);

	// Consider lines similar if they share at least 30% of words
	return similarity >= 0.3;
}
