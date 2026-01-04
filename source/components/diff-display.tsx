import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';
import type {Colors} from '@/types/index';
import {areLinesSimlar, computeInlineDiff} from '@/utils/inline-diff';

interface DiffDisplayProps {
	oldLines: string[];
	newLines: string[];
	startLine: number;
	contextBeforeLines: Array<{lineNum: number; content: string}>;
	contextAfterLines: Array<{lineNum: number; content: string}>;
	themeColors: Colors;
	language: string;
}

/**
 * Component to display inline diff with context lines.
 * Handles normalization and rendering of added/removed lines with highlighting.
 */
export const DiffDisplay: React.FC<DiffDisplayProps> = ({
	oldLines,
	newLines,
	startLine,
	contextBeforeLines,
	contextAfterLines,
	themeColors,
	language,
}) => {
	const contextBefore: React.ReactElement[] = [];
	const diffLines: React.ReactElement[] = [];
	const contextAfter: React.ReactElement[] = [];

	// Show context before
	for (const {lineNum, content} of contextBeforeLines) {
		const lineNumStr = String(lineNum).padStart(4, ' ');
		let displayLine: string;
		try {
			displayLine = highlight(content, {language, theme: 'default'});
		} catch {
			displayLine = content;
		}

		contextBefore.push(
			<Text key={`before-${lineNum}`} color={themeColors.secondary}>
				{lineNumStr} {displayLine}
			</Text>,
		);
	}

	// Build unified diff - only show lines that actually changed
	let oldIdx = 0;
	let newIdx = 0;
	let diffKey = 0;

	while (oldIdx < oldLines.length || newIdx < newLines.length) {
		const oldLine = oldIdx < oldLines.length ? oldLines[oldIdx] : null;
		const newLine = newIdx < newLines.length ? newLines[newIdx] : null;

		// Check if lines are identical - show as unchanged context
		if (oldLine !== null && newLine !== null && oldLine === newLine) {
			const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');
			diffLines.push(
				<Text
					key={`diff-${diffKey++}`}
					color={themeColors.secondary}
					wrap="wrap"
				>
					{lineNumStr} {oldLine}
				</Text>,
			);
			oldIdx++;
			newIdx++;
		} else if (
			oldLine !== null &&
			newLine !== null &&
			areLinesSimlar(oldLine, newLine)
		) {
			// Lines are similar but different - show inline diff with word-level highlighting
			const segments = computeInlineDiff(oldLine, newLine);
			const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');

			// Render removed line with inline highlights
			const oldParts: React.ReactElement[] = [];
			for (let s = 0; s < segments.length; s++) {
				const seg = segments[s];
				if (seg.type === 'unchanged' || seg.type === 'removed') {
					oldParts.push(
						<Text
							key={`old-seg-${s}`}
							bold={seg.type === 'removed'}
							underline={seg.type === 'removed'}
						>
							{seg.text}
						</Text>,
					);
				}
			}

			diffLines.push(
				<Text
					key={`diff-${diffKey++}`}
					backgroundColor={themeColors.diffRemoved}
					color={themeColors.diffRemovedText}
					wrap="wrap"
				>
					{lineNumStr} - {oldParts}
				</Text>,
			);

			// Render added line with inline highlights
			const newParts: React.ReactElement[] = [];
			for (let s = 0; s < segments.length; s++) {
				const seg = segments[s];
				if (seg.type === 'unchanged' || seg.type === 'added') {
					newParts.push(
						<Text
							key={`new-seg-${s}`}
							bold={seg.type === 'added'}
							underline={seg.type === 'added'}
						>
							{seg.text}
						</Text>,
					);
				}
			}

			diffLines.push(
				<Text
					key={`diff-${diffKey++}`}
					backgroundColor={themeColors.diffAdded}
					color={themeColors.diffAddedText}
					wrap="wrap"
				>
					{lineNumStr} + {newParts}
				</Text>,
			);

			oldIdx++;
			newIdx++;
		} else if (oldLine !== null) {
			// Show removed line
			const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');
			diffLines.push(
				<Text
					key={`diff-${diffKey++}`}
					backgroundColor={themeColors.diffRemoved}
					color={themeColors.diffRemovedText}
					wrap="wrap"
				>
					{lineNumStr} - {oldLine}
				</Text>,
			);
			oldIdx++;
		} else if (newLine !== null) {
			// Show added line
			const lineNumStr = String(startLine + newIdx).padStart(4, ' ');
			diffLines.push(
				<Text
					key={`diff-${diffKey++}`}
					backgroundColor={themeColors.diffAdded}
					color={themeColors.diffAddedText}
					wrap="wrap"
				>
					{lineNumStr} + {newLine}
				</Text>,
			);
			newIdx++;
		}
	}

	// Show context after
	const lineDelta = newLines.length - oldLines.length;
	for (const {lineNum, content} of contextAfterLines) {
		const actualLineNum = lineNum;
		const lineNumStr = String(actualLineNum + lineDelta + 1).padStart(4, ' ');
		let displayLine: string;
		try {
			displayLine = highlight(content, {language, theme: 'default'});
		} catch {
			displayLine = content;
		}

		contextAfter.push(
			<Text key={`after-${lineNum}`} color={themeColors.secondary}>
				{lineNumStr} {displayLine}
			</Text>,
		);
	}

	// If there's nothing to display, return an indicator
	if (
		contextBefore.length === 0 &&
		diffLines.length === 0 &&
		contextAfter.length === 0
	) {
		return (
			<Box>
				<Text color={themeColors.secondary}>(No changes to display)</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column">
			{contextBefore}
			{diffLines}
			{contextAfter}
		</Box>
	);
};
