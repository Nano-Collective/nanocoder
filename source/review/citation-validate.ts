/**
 * Deterministic citation validation for review findings.
 *
 * Before a finding is sent to a verifier, its citation is checked against
 * the actual repository: the file must exist under the project root, the
 * line must be within the file, and — when changed-line data is available —
 * the line must fall in or next to a changed hunk. This is cheap, runs
 * without a model, and kills hallucinated citations before they cost a
 * verifier call.
 */

import {existsSync, readFileSync} from 'node:fs';
import {join, resolve} from 'node:path';

export interface ChangedLines {
	/** Map of workspace-relative file path to the set of changed line numbers. */
	files: Map<string, Set<number>>;
}

export interface CitationValidationResult {
	valid: Array<{file: string; line: number}>;
	invalid: Array<{file: string; line: number; reason: string}>;
}

/** Read one file's line count; null when the file does not exist. */
function lineCount(projectRoot: string, file: string): number | null {
	try {
		const absolute = resolve(join(projectRoot, file));
		if (!existsSync(absolute)) {
			return null;
		}
		const content = readFileSync(absolute, 'utf8');
		// A trailing newline does not create a reviewable extra line.
		const lines = content.split('\n');
		if (lines.length > 0 && lines[lines.length - 1] === '') {
			lines.pop();
		}
		return lines.length;
	} catch {
		return null;
	}
}

/**
 * Build the changed-line map from a unified diff (the same format
 * `git diff` produces and the review target resolver hands over).
 */
export function changedLinesFromDiff(diff: string): ChangedLines {
	const files = new Map<string, Set<number>>();
	let currentFile: string | null = null;
	let newLine = 0;

	for (const line of diff.split('\n')) {
		if (line.startsWith('+++ b/')) {
			currentFile = line.slice(6).trim();
			continue;
		}
		if (line.startsWith('+++ ')) {
			// /dev/null or an unusual prefix: nothing trackable.
			currentFile = null;
			continue;
		}
		if (line.startsWith('@@')) {
			// "@@ -1,3 +1,4 @@": the new-file start follows the plus sign.
			const match = line.match(/\+(\d+)/);
			if (match && currentFile) {
				newLine = Number.parseInt(match[1], 10);
			}
			continue;
		}
		if (!currentFile) {
			continue;
		}
		if (line.startsWith('+') || line.startsWith(' ')) {
			if (!line.startsWith('+++')) {
				let set = files.get(currentFile);
				if (!set) {
					set = new Set<number>();
					files.set(currentFile, set);
				}
				set.add(newLine);
				newLine++;
			}
		} else if (line.startsWith('-')) {
			// Deleted lines do not advance the new-file cursor.
		} else if (line.startsWith('\\')) {
			// "\ No newline at end of file" — no cursor movement.
		}
	}

	return {files};
}

/**
 * Check one citation against the project root and, when provided, the
 * changed-line map. A citation is valid when the file exists and the line
 * is in range. When changed-line data is available, the line must fall in
 * or within three lines of a changed hunk (context lines around a fix are
 * legitimate review targets).
 */
export function validateCitations(
	projectRoot: string,
	citations: Array<{file: string; line: number}>,
	changed?: ChangedLines,
): CitationValidationResult {
	const valid: CitationValidationResult['valid'] = [];
	const invalid: CitationValidationResult['invalid'] = [];

	for (const citation of citations) {
		const exists = lineCount(projectRoot, citation.file);
		if (exists === null) {
			invalid.push({
				...citation,
				reason: `file not found under project root: ${citation.file}`,
			});
			continue;
		}
		if (citation.line > exists) {
			invalid.push({
				...citation,
				reason: `line ${citation.line} is past end of file (${exists} lines)`,
			});
			continue;
		}

		if (changed) {
			const changedSet = changed.files.get(citation.file);
			if (!changedSet || changedSet.size === 0) {
				invalid.push({
					...citation,
					reason: `file is not part of the reviewed changes: ${citation.file}`,
				});
				continue;
			}
			const nearChange = [...changedSet].some(
				changedLine => Math.abs(changedLine - citation.line) <= 3,
			);
			if (!nearChange) {
				invalid.push({
					...citation,
					reason: `line ${citation.line} is not in or near the changed hunks`,
				});
				continue;
			}
		}

		valid.push({file: citation.file, line: citation.line});
	}

	return {valid, invalid};
}
