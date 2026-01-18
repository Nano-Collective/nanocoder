/**
 * Validation Results Component
 *
 * Displays validation results for plan documents.
 * Shows errors, warnings, and info messages with appropriate styling.
 */

import {Box, Text} from 'ink';
import type {ValidationResult} from '@/types/validation';

interface ValidationResultsProps {
	/** Validation result to display */
	result: ValidationResult;
	/** Whether to show all details or just summary */
	showDetails?: boolean;
}

/**
 * Get issue icon based on level
 */
function getIssueIcon(level: 'error' | 'warning' | 'info'): string {
	switch (level) {
		case 'error':
			return '✗';
		case 'warning':
			return '⚠';
		case 'info':
			return 'ℹ';
	}
}

/**
 * Get issue color based on level
 */
function getIssueColor(level: 'error' | 'warning' | 'info'): string {
	switch (level) {
		case 'error':
			return '#ff5555';
		case 'warning':
			return '#ffaa00';
		case 'info':
			return '#00aaff';
	}
}

/**
 * Display a single issue
 */
function Issue({
	level,
	message,
}: {
	level: 'error' | 'warning' | 'info';
	message: string;
}): React.ReactElement {
	const icon = getIssueIcon(level);
	const color = getIssueColor(level);

	return (
		<Box>
			<Text color={color}>
				{icon} {message}
			</Text>
		</Box>
	);
}

/**
 * Display issues grouped by level
 */
function IssueGroup({
	level,
	issues,
	label,
}: {
	level: 'error' | 'warning' | 'info';
	issues: Array<{message: string}>;
	label: string;
}): React.ReactElement | null {
	if (issues.length === 0) {
		return null;
	}

	const color = getIssueColor(level);

	return (
		<Box
			key={level}
			flexDirection="column"
			marginTop={issues.length > 0 ? 1 : 0}
		>
			<Text color={color} bold>
				{label} ({issues.length}):
			</Text>
			{issues.map((issue, index) => (
				<Box key={index} paddingLeft={2}>
					<Issue level={level} message={issue.message} />
				</Box>
			))}
		</Box>
	);
}

/**
 * Validation Results component
 *
 * Displays validation results with:
 * - Overall status (valid/invalid)
 * - Grouped issues by level (errors, warnings, info)
 * - Document-specific validation (when available)
 */
export function ValidationResults({
	result,
	showDetails = true,
}: ValidationResultsProps): React.ReactElement {
	const {valid, errors, warnings, info, documents} = result;

	// Calculate total issue count
	const totalErrors = errors.length;
	const totalWarnings = warnings.length;
	const totalInfo = info.length;
	const totalIssues = totalErrors + totalWarnings + totalInfo;

	// If valid and no issues, show success message
	if (valid && totalIssues === 0) {
		return (
			<Box marginTop={1}>
				<Text color="#00ff00">✓ Validation passed - all checks OK</Text>
			</Box>
		);
	}

	// Show overall status
	const statusColor = valid ? '#ffaa00' : '#ff5555';
	const statusText = valid
		? '⚠ Validation passed with warnings'
		: '✗ Validation failed';

	return (
		<Box flexDirection="column" marginTop={1}>
			{/* Status header */}
			<Box>
				<Text bold color={statusColor}>
					{statusText}
				</Text>
				{!valid && totalErrors > 0 && (
					<Text dimColor>
						{' '}
						({totalErrors} error{totalErrors > 1 ? 's' : ''})
					</Text>
				)}
				{totalWarnings > 0 && (
					<Text dimColor color={getIssueColor('warning')}>
						, {totalWarnings} warning{totalWarnings > 1 ? 's' : ''}
					</Text>
				)}
			</Box>

			{/* Show issues if details requested */}
			{showDetails && totalIssues > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<IssueGroup level="error" issues={errors} label="Errors" />
					<IssueGroup level="warning" issues={warnings} label="Warnings" />
					<IssueGroup level="info" issues={info} label="Info" />
				</Box>
			)}

			{/* Show document-specific results if available */}
			{showDetails && documents && (
				<Box flexDirection="column" marginTop={1}>
					<Text bold dimColor>
						Document Results:
					</Text>
					{Object.entries(documents).map(([docType, docResult]) => (
						<Box key={docType} paddingLeft={2} marginTop={1}>
							<Text dimColor>{docResult.document}: </Text>
							<Text color={docResult.valid ? '#00ff00' : '#ff5555'}>
								{docResult.valid ? '✓' : '✗'}
							</Text>
							{!docResult.valid && docResult.errors.length > 0 && (
								<Text dimColor>
									({docResult.errors.length} issue
									{docResult.errors.length > 1 ? 's' : ''})
								</Text>
							)}
						</Box>
					))}
				</Box>
			)}
		</Box>
	);
}

/**
 * Compact validation results component
 * Shows a single-line summary with issue counts
 */
export function CompactValidationResults({
	result,
}: {
	result: ValidationResult;
}): React.ReactElement {
	const {valid, errors, warnings, info} = result;

	// If valid and no issues, show simple success
	if (
		valid &&
		errors.length === 0 &&
		warnings.length === 0 &&
		info.length === 0
	) {
		return <Text color="#00ff00">✓ Valid</Text>;
	}

	const parts: string[] = [];

	if (!valid) {
		parts.push(`✗ ${errors.length} error${errors.length > 1 ? 's' : ''}`);
	}
	if (warnings.length > 0) {
		parts.push(`⚠ ${warnings.length} warning${warnings.length > 1 ? 's' : ''}`);
	}
	if (info.length > 0) {
		parts.push(`ℹ ${info.length} info`);
	}

	return <Text color={valid ? '#ffaa00' : '#ff5555'}>{parts.join(' | ')}</Text>;
}
