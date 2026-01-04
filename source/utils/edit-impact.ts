import type {ChangeStatistics} from './change-calculator';

/**
 * Information about the impact of an edit operation.
 */
export interface EditImpact {
	severity: 'low' | 'medium' | 'high' | 'critical';
	description: string;
	tokenImpact: number;
	shouldWarn: boolean;
	recommendations: string[];
}

/**
 * Thresholds for determining edit severity.
 */
const SEVERITY_THRESHOLDS = {
	low: 0.1, // Less than 10% of file
	medium: 0.3, // 10-30% of file
	high: 0.5, // 30-50% of file
	critical: 0.8, // 50-80% of file (anything above is also critical)
} as const;

/**
 * Estimate the impact of an edit operation for user feedback.
 *
 * This function analyzes change statistics in the context of the overall
 * file size to provide meaningful feedback about the scope and impact
 * of an edit, including severity levels and recommendations.
 *
 * @param changeStats - Statistics about the changes being made
 * @param fileSize - Information about the total file size (lines and tokens)
 * @returns Impact assessment with severity, description, and recommendations
 */
export function estimateEditImpact(
	changeStats: ChangeStatistics,
	fileSize: {lines: number; tokens: number},
): EditImpact {
	// Calculate percentage of file changed
	// For replace scenarios, use the number of distinct positions being changed
	// For insert/delete scenarios, use net change
	let lineChangePercentage: number;
	if (changeStats.changeType === 'replace') {
		// For replace, count the positions being changed (not the sum)
		// Replacing 10 lines with 10 new lines = 10 positions changed
		const linesChanged = Math.max(
			changeStats.linesAdded,
			changeStats.linesRemoved,
		);
		lineChangePercentage = linesChanged / Math.max(fileSize.lines, 1);
	} else {
		lineChangePercentage =
			Math.abs(changeStats.netLineChange) / Math.max(fileSize.lines, 1);
	}

	// For replace operations, use max tokens (like we do for lines)
	// For insert/delete, use sum to account for actual token change
	let tokenChangePercentage: number;
	if (changeStats.changeType === 'replace') {
		const tokensChanged = Math.max(
			changeStats.tokensAdded,
			changeStats.tokensRemoved,
		);
		tokenChangePercentage = tokensChanged / Math.max(fileSize.tokens, 1);
	} else {
		tokenChangePercentage =
			(changeStats.tokensAdded + changeStats.tokensRemoved) /
			Math.max(fileSize.tokens, 1);
	}

	// Use the larger of the two percentages for severity
	const maxChangePercentage = Math.max(
		lineChangePercentage,
		tokenChangePercentage,
	);

	// Determine severity
	let severity: EditImpact['severity'] = 'low';
	if (maxChangePercentage <= SEVERITY_THRESHOLDS.low) {
		// Up to 10% = low
		severity = 'low';
	} else if (
		maxChangePercentage > SEVERITY_THRESHOLDS.low &&
		maxChangePercentage <= SEVERITY_THRESHOLDS.medium
	) {
		// 10-25% = medium
		severity = 'medium';
	} else if (
		maxChangePercentage > SEVERITY_THRESHOLDS.medium &&
		maxChangePercentage <= SEVERITY_THRESHOLDS.high
	) {
		// 25-50% = high
		severity = 'high';
	} else {
		// 50%+ = critical
		severity = 'critical';
	}

	// Generate description
	const description = generateDescription(
		changeStats,
		fileSize,
		lineChangePercentage,
	);

	// Determine if warning is needed
	const shouldWarn = severity === 'high' || severity === 'critical';

	// Generate recommendations
	const recommendations = generateRecommendations(
		changeStats,
		fileSize,
		lineChangePercentage,
	);

	return {
		severity,
		description,
		tokenImpact: changeStats.netTokenChange,
		shouldWarn,
		recommendations,
	};
}

/**
 * Generate a human-readable description of the edit impact.
 */
function generateDescription(
	changeStats: ChangeStatistics,
	fileSize: {lines: number; tokens: number},
	changePercentage: number,
): string {
	const percentage = Math.round(changePercentage * 100);
	const linesAdded = changeStats.linesAdded;
	const linesRemoved = changeStats.linesRemoved;
	const netLines = changeStats.netLineChange;

	if (changeStats.changeType === 'insert') {
		return `Adding ${linesAdded} lines (${percentage}% of file)`;
	}

	if (changeStats.changeType === 'delete') {
		return `Removing ${linesRemoved} lines (${percentage}% of file)`;
	}

	if (changeStats.changeType === 'replace') {
		if (netLines === 0) {
			return `Replacing ${linesAdded} lines (${percentage}% of file)`;
		} else if (netLines > 0) {
			return `Replacing ${linesRemoved} with ${linesAdded} lines (net +${netLines}, ${percentage}% of file)`;
		}
		return `Replacing ${linesRemoved} with ${linesAdded} lines (net ${netLines}, ${percentage}% of file)`;
	}

	return `Minor change (${percentage}% of file)`;
}

/**
 * Generate actionable recommendations based on edit impact.
 */
function generateRecommendations(
	changeStats: ChangeStatistics,
	fileSize: {lines: number; tokens: number},
	changePercentage: number,
): string[] {
	const recommendations: string[] = [];

	// Large changes
	if (changePercentage >= 0.5) {
		recommendations.push(
			'Consider breaking this into smaller, independent edits',
		);
	}

	// Replacing large portions
	if (changeStats.changeType === 'replace' && changePercentage >= 0.3) {
		recommendations.push('Large replacement detected - verify logic carefully');
	}

	// Deleting large portions
	if (changeStats.changeType === 'delete' && changePercentage >= 0.25) {
		recommendations.push(
			'Significant deletion - ensure no critical code is lost',
		);
	}

	// Net line change for large additions
	if (changeStats.netLineChange > 50) {
		recommendations.push(
			'Consider if file organization needs review for new code',
		);
	}

	// Token impact for very large changes
	const totalTokens = changeStats.tokensAdded + changeStats.tokensRemoved;
	if (totalTokens > 500) {
		recommendations.push(
			'Large token change may affect model context - review carefully',
		);
	}

	// File type-specific recommendations could be added here
	// e.g., for test files, suggest test coverage review

	return recommendations;
}
