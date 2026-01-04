import {diffLines} from 'diff';

/**
 * Represents a single line in a diff with its change type.
 */
export interface DiffLine {
	type: 'added' | 'removed' | 'unchanged' | 'context';
	lineNumber: number;
	content: string;
}

/**
 * Summary statistics about a formatted diff.
 */
export interface DiffSummary {
	totalLines: number;
	addedLines: number;
	removedLines: number;
	contextLines: number;
}

/**
 * A structured representation of a diff with lines and summary.
 */
export interface FormattedDiff {
	lines: DiffLine[];
	summary: DiffSummary;
}

/**
 * Default number of context lines to show around changes.
 */
const DEFAULT_CONTEXT_LINES = 2;

/**
 * Format an inline diff between old and new content.
 *
 * This function creates a structured diff representation with contextual
 * lines, making it easy to render in UI components. It uses line-based
 * diffing to show what changed.
 *
 * @param oldContent - The original content before changes
 * @param newContent - The updated content after changes
 * @param contextLines - Number of context lines to show around changes (default: 2)
 * @returns A formatted diff with line-by-line changes and summary statistics
 */
export function formatInlineDiff(
	oldContent: string,
	newContent: string,
	contextLines: number = DEFAULT_CONTEXT_LINES,
): FormattedDiff {
	const diff = diffLines(oldContent, newContent);
	const lines: DiffLine[] = [];
	let _oldLineNumber = 0;
	let _newLineNumber = 0;

	// Collect all diff positions first for better context handling
	type DiffItem = {
		changed: boolean;
		added?: boolean;
		removed?: boolean;
		value: string;
	};

	// First pass: collect all diff items
	const allItems: DiffItem[] = [];
	for (const change of diff) {
		const linesInChange = change.value
			.split('\n')
			.filter((l, i, arr) => !(l === '' && i === arr.length - 1)); // Filter trailing empty strings only
		if (change.removed) {
			allItems.push(
				...linesInChange.map(line => ({
					changed: true,
					removed: true,
					value: line,
				})),
			);
		} else if (change.added) {
			allItems.push(
				...linesInChange.map(line => ({
					changed: true,
					added: true,
					value: line,
				})),
			);
		} else {
			allItems.push(
				...linesInChange.map(line => ({changed: false, value: line})),
			);
		}
	}

	// Second pass: add context lines around changes
	const processedLines: (DiffItem & {index: number})[] = [];
	for (let i = 0; i < allItems.length; i++) {
		const item = allItems[i];

		if (item.changed) {
			// Add context before
			for (let ctx = Math.max(0, i - contextLines); ctx < i; ctx++) {
				const contextItem = allItems[ctx];
				if (
					!processedLines.find(p => p.index === ctx) &&
					!contextItem.changed
				) {
					processedLines.push({...contextItem, index: ctx});
				}
			}

			// Add changed item
			processedLines.push({...item, index: i});

			// Add context after
			for (
				let ctx = i + 1;
				ctx < Math.min(allItems.length, i + contextLines + 1);
				ctx++
			) {
				const contextItem = allItems[ctx];
				if (
					!processedLines.find(p => p.index === ctx) &&
					!contextItem.changed
				) {
					processedLines.push({...contextItem, index: ctx});
				}
			}
		}
	}

	// Third pass: convert to DiffLine objects
	// Use sequential display line numbers (1, 2, 3, ...) for consistent ordering
	let displayLineNumber = 0;
	for (const item of processedLines.sort((a, b) => a.index - b.index)) {
		displayLineNumber++;
		if (item.added) {
			_newLineNumber++;
			lines.push({
				type: 'added',
				lineNumber: displayLineNumber, // Use sequential display line number
				content: item.value,
			});
		} else if (item.removed) {
			_oldLineNumber++;
			lines.push({
				type: 'removed',
				lineNumber: displayLineNumber, // Use sequential display line number
				content: item.value,
			});
		} else {
			_oldLineNumber++;
			_newLineNumber++;
			// Determine if this is context or unchanged
			const prevItem = processedLines[processedLines.indexOf(item) - 1];
			const nextItem = processedLines[processedLines.indexOf(item) + 1];
			const nearChange = prevItem?.changed || nextItem?.changed;
			lines.push({
				type: nearChange ? 'context' : 'unchanged',
				lineNumber: displayLineNumber, // Use sequential display line number
				content: item.value,
			});
		}
	}

	// Calculate summary
	// Remove identical lines from both adds and removes (they cancel out)
	// This handles cases where the diff library treats additions at the end as replacements
	const removedContent = lines
		.filter(l => l.type === 'removed')
		.map(l => l.content);
	const addedContent = lines
		.filter(l => l.type === 'added')
		.map(l => l.content);

	// Create frequency maps to handle duplicates correctly
	const removedCounts = new Map<string, number>();
	const addedCounts = new Map<string, number>();

	removedContent.forEach(content => {
		removedCounts.set(content, (removedCounts.get(content) || 0) + 1);
	});

	addedContent.forEach(content => {
		addedCounts.set(content, (addedCounts.get(content) || 0) + 1);
	});

	// Match up identical strings and subtract from both counts
	const matchedContent = new Set<string>();
	for (const [content, count] of removedCounts) {
		const matchCount = Math.min(count, addedCounts.get(content) || 0);
		if (matchCount > 0) {
			matchedContent.add(content);
			removedCounts.set(content, count - matchCount);
			addedCounts.set(content, (addedCounts.get(content) || 0) - matchCount);
		}
	}

	// Sum remaining counts
	const actualAddedLines = Array.from(addedCounts.values()).reduce(
		(sum, count) => sum + count,
		0,
	);
	const actualRemovedLines = Array.from(removedCounts.values()).reduce(
		(sum, count) => sum + count,
		0,
	);

	// Handle edge cases where content is completely removed or added
	if (newContent === '') {
		// No added content, skip matching logic
		const actualAddedLinesEdge = 0;
		const actualRemovedLinesEdge = lines.filter(
			l => l.type === 'removed',
		).length;

		const summary: DiffSummary = {
			totalLines: lines.length,
			addedLines: actualAddedLinesEdge,
			removedLines: actualRemovedLinesEdge,
			contextLines: lines.filter(l => l.type === 'context').length,
		};

		return {lines, summary};
	}

	// Similarly for oldContent === ''
	if (oldContent === '') {
		const actualAddedLinesEdge = lines.filter(l => l.type === 'added').length;
		const actualRemovedLinesEdge = 0;

		const summary: DiffSummary = {
			totalLines: lines.length,
			addedLines: actualAddedLinesEdge,
			removedLines: actualRemovedLinesEdge,
			contextLines: lines.filter(l => l.type === 'context').length,
		};

		return {lines, summary};
	}

	// Before filtering, determine how many of each matched content to remove
	// We need to preserve the original counts before they were modified
	const contentToRemove = new Map<string, number>();
	const originalRemovedCounts = new Map<string, number>();
	const originalAddedCounts = new Map<string, number>();

	// Get the original counts before matching
	removedContent.forEach(content => {
		originalRemovedCounts.set(
			content,
			(originalRemovedCounts.get(content) || 0) + 1,
		);
	});

	addedContent.forEach(content => {
		originalAddedCounts.set(
			content,
			(originalAddedCounts.get(content) || 0) + 1,
		);
	});

	// Calculate how many to remove for each content
	for (const [content] of originalRemovedCounts) {
		const removedTotal = originalRemovedCounts.get(content) || 0;
		const addedTotal = originalAddedCounts.get(content) || 0;
		const matchCount = Math.min(removedTotal, addedTotal);
		if (matchCount > 0) {
			contentToRemove.set(content, matchCount);
		}
	}

	// Filter lines while tracking removal counts separately for removed and added
	const contentRemovedFromRemoved = new Map<string, number>();
	const contentRemovedFromAdded = new Map<string, number>();
	const filteredLines = lines.filter(line => {
		if (line.type === 'removed' && contentToRemove.has(line.content)) {
			const toRemove = contentToRemove.get(line.content);
			if (toRemove !== undefined) {
				const alreadyRemoved = contentRemovedFromRemoved.get(line.content) || 0;
				if (alreadyRemoved < toRemove) {
					contentRemovedFromRemoved.set(line.content, alreadyRemoved + 1);
					return false;
				}
			}
		}
		if (line.type === 'added' && contentToRemove.has(line.content)) {
			const toRemove = contentToRemove.get(line.content);
			if (toRemove !== undefined) {
				const alreadyRemoved = contentRemovedFromAdded.get(line.content) || 0;
				if (alreadyRemoved < toRemove) {
					contentRemovedFromAdded.set(line.content, alreadyRemoved + 1);
					return false;
				}
			}
		}
		return true;
	});

	const summary: DiffSummary = {
		totalLines: filteredLines.length,
		addedLines: actualAddedLines,
		removedLines: actualRemovedLines,
		contextLines: filteredLines.filter(l => l.type === 'context').length,
	};

	return {lines: filteredLines, summary};
}
