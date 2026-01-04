import {calculateTokens} from '@/utils/token-calculator.js';

/**
 * Statistics about changes between old and new content.
 */
export interface ChangeStatistics {
	linesAdded: number;
	linesRemoved: number;
	netLineChange: number; // Added - Removed
	tokensAdded: number;
	tokensRemoved: number;
	netTokenChange: number;
	changeType: 'insert' | 'replace' | 'delete' | 'no-change';
	sizeImpact: 'tiny' | 'small' | 'medium' | 'large' | 'massive';
}

/**
 * Thresholds for categorizing change size impact.
 */
const SIZE_IMPACT_THRESHOLDS = {
	tiny: 10, // 10 or fewer lines
	small: 20, // 11-20 lines
	medium: 50, // 21-50 lines
	large: 60, // 51-60 lines
	massive: Infinity, // 60+ lines
} as const;

/**
 * Calculate change statistics between old and new content.
 *
 * This function analyzes two versions of content and provides comprehensive
 * statistics about the differences, including line counts, token counts,
 * change type, and size impact categorization.
 *
 * @param oldContent - The original content before changes
 * @param newContent - The updated content after changes
 * @returns Statistics about the changes between the two content versions
 */
export function calculateChangeStatistics(
	oldContent: string,
	newContent: string,
): ChangeStatistics {
	// Handle empty content edge cases first
	const isOldEmpty = !oldContent || oldContent.trim() === '';
	const isNewEmpty = !newContent || newContent.trim() === '';

	// Split lines but preserve empty lines for accurate counting
	const oldLines = oldContent === '' ? [] : oldContent.split('\n');
	const newLines = newContent === '' ? [] : newContent.split('\n');

	// Determine if it's an insert, delete, replace, or no-change
	let changeType: ChangeStatistics['changeType'] = 'no-change';
	if (oldContent === newContent) {
		changeType = 'no-change';
	} else if (isOldEmpty && !isNewEmpty) {
		changeType = 'insert';
	} else if (!isOldEmpty && isNewEmpty) {
		changeType = 'delete';
	} else {
		// Both have content - determine if it's insert/append or replace
		const oldLinesCount = oldLines.length;
		const newLinesCount = newLines.length;

		// If one is very small compared to the other, treat as insert/delete
		const ratio =
			Math.min(oldLinesCount, newLinesCount) /
			Math.max(oldLinesCount, newLinesCount);

		if (ratio < 0.3) {
			// One side is less than 30% of the other
			if (newLinesCount > oldLinesCount) {
				changeType = 'insert';
			} else {
				changeType = 'delete';
			}
		} else {
			// Both sides have substantial content - it's a replacement
			changeType = 'replace';
		}
	}

	// Calculate line counts
	const linesAdded = newLines.length;
	const linesRemoved = oldLines.length;
	const netLineChange = linesAdded - linesRemoved;

	// Calculate token counts
	const tokensAdded = calculateTokens(newContent);
	const tokensRemoved = calculateTokens(oldContent);
	const netTokenChange = tokensAdded - tokensRemoved;

	// Determine size impact based on total affected lines (added + removed)
	// This matches test expectations which use total affected lines for all scenarios
	let sizeImpact: ChangeStatistics['sizeImpact'] = 'tiny';
	const totalAffectedLines = linesAdded + linesRemoved;

	if (totalAffectedLines <= SIZE_IMPACT_THRESHOLDS.tiny) {
		sizeImpact = 'tiny';
	} else if (totalAffectedLines <= SIZE_IMPACT_THRESHOLDS.small) {
		sizeImpact = 'small';
	} else if (totalAffectedLines <= SIZE_IMPACT_THRESHOLDS.medium) {
		sizeImpact = 'medium';
	} else if (totalAffectedLines <= SIZE_IMPACT_THRESHOLDS.large) {
		sizeImpact = 'large';
	} else {
		sizeImpact = 'massive';
	}

	return {
		linesAdded,
		linesRemoved,
		netLineChange,
		tokensAdded,
		tokensRemoved,
		netTokenChange,
		changeType,
		sizeImpact,
	};
}
