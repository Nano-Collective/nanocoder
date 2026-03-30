import {resolve} from 'node:path';
import {highlight} from 'cli-highlight';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {getColors} from '@/config/index';
import {DEFAULT_TERMINAL_COLUMNS} from '@/constants';
import type {Colors} from '@/types/index';
import {truncateAnsi} from '@/utils/ansi-truncate';
import {getCachedFileContent} from '@/utils/file-cache';
import {normalizeIndentation} from '@/utils/indentation-normalizer';
import {areLinesSimlar, computeInlineDiff} from '@/utils/inline-diff';
import {getLanguageFromExtension} from '@/utils/programming-language-helper';

interface StringReplaceArgs {
	path: string;
	old_str: string;
	new_str: string;
}

/** Truncate a plain line to fit terminal width */
const truncateLine = (line: string, maxWidth: number): string => {
	if (line.length <= maxWidth) return line;
	return line.slice(0, maxWidth - 1) + '…';
};

export async function formatStringReplacePreview(
	args: StringReplaceArgs,
	result?: string,
	colors?: Colors,
): Promise<React.ReactElement> {
	const themeColors = colors || getColors();
	const {path, old_str, new_str} = args;

	const terminalWidth = process.stdout.columns || DEFAULT_TERMINAL_COLUMNS;
	const lineNumPrefixWidth = 8;
	const availableWidth = Math.max(terminalWidth - lineNumPrefixWidth - 2, 20);

	const isResult = result !== undefined;

	try {
		const absPath = resolve(path);
		const cached = await getCachedFileContent(absPath);
		const fileContent = cached.content;
		const ext = path.split('.').pop()?.toLowerCase() ?? '';
		const language = getLanguageFromExtension(ext);

		// Preview mode - validate old_str exists and is unique
		if (!isResult) {
			const occurrences = fileContent.split(old_str).length - 1;

			if (occurrences === 0) {
				return (
					<ToolMessage
						message={
							<Box flexDirection="column" marginBottom={1}>
								<Text color={themeColors.tool}>⚒ string_replace</Text>
								<Box>
									<Text color={themeColors.secondary}>Path: </Text>
									<Text wrap="truncate-end" color={themeColors.primary}>
										{path}
									</Text>
								</Box>
								<Box flexDirection="column" marginTop={1}>
									<Text color={themeColors.error}>
										✗ Error: Content not found in file. The file may have
										changed since you last read it.
									</Text>
								</Box>
							</Box>
						}
						hideBox={true}
					/>
				);
			}

			if (occurrences > 1) {
				return (
					<ToolMessage
						message={
							<Box flexDirection="column">
								<Text color={themeColors.tool}>⚒ string_replace</Text>
								<Box>
									<Text color={themeColors.secondary}>Path: </Text>
									<Text wrap="truncate-end" color={themeColors.primary}>
										{path}
									</Text>
								</Box>
								<Box flexDirection="column" marginTop={1}>
									<Text color={themeColors.error}>
										✗ Error: Found {occurrences} matches
									</Text>
									<Text color={themeColors.secondary}>
										Add more surrounding context to make the match unique.
									</Text>
								</Box>
							</Box>
						}
						hideBox={true}
					/>
				);
			}
		}

		// Find location of the match in the file
		const searchStr = isResult ? new_str : old_str;
		const matchIndex = fileContent.indexOf(searchStr);
		const beforeContent = fileContent.substring(0, matchIndex);
		const beforeLines = beforeContent.split('\n');
		const startLine = beforeLines.length;

		const oldStrLines = old_str.split('\n');
		const newStrLines = new_str.split('\n');
		const contentLines = isResult ? newStrLines : oldStrLines;
		const endLine = startLine + contentLines.length - 1;

		const allLines = fileContent.split('\n');
		const contextLines = 3;
		const showStart = Math.max(0, startLine - 1 - contextLines);
		const showEnd = Math.min(allLines.length - 1, endLine - 1 + contextLines);

		// Collect all lines for normalization
		const linesToNormalize: string[] = [];

		for (let i = showStart; i < startLine - 1; i++) {
			linesToNormalize.push(allLines[i] || '');
		}
		for (let i = 0; i < oldStrLines.length; i++) {
			linesToNormalize.push(oldStrLines[i] || '');
		}
		if (isResult) {
			for (let i = 0; i < newStrLines.length; i++) {
				linesToNormalize.push(allLines[startLine - 1 + i] || '');
			}
		} else {
			for (let i = 0; i < newStrLines.length; i++) {
				linesToNormalize.push(newStrLines[i] || '');
			}
		}
		const contextAfterStart = isResult
			? startLine - 1 + newStrLines.length
			: endLine;
		for (let i = contextAfterStart; i <= showEnd; i++) {
			linesToNormalize.push(allLines[i] || '');
		}

		const normalizedLines = normalizeIndentation(linesToNormalize);

		// Split normalized lines back into sections
		let lineIndex = 0;
		const contextBeforeCount = startLine - 1 - showStart;
		const normalizedContextBefore = normalizedLines.slice(
			lineIndex,
			lineIndex + contextBeforeCount,
		);
		lineIndex += contextBeforeCount;
		const normalizedOldLines = normalizedLines.slice(
			lineIndex,
			lineIndex + oldStrLines.length,
		);
		lineIndex += oldStrLines.length;
		const normalizedNewLines = normalizedLines.slice(
			lineIndex,
			lineIndex + newStrLines.length,
		);
		lineIndex += newStrLines.length;
		const normalizedContextAfter = normalizedLines.slice(lineIndex);

		// Render context before
		const contextBefore = normalizedContextBefore.map((line, i) => {
			const actualLineNum = showStart + i;
			const lineNumStr = String(actualLineNum + 1).padStart(4, ' ');
			let displayLine: string;
			try {
				displayLine = truncateAnsi(
					highlight(line, {language, theme: 'default'}),
					availableWidth,
				);
			} catch {
				displayLine = truncateLine(line, availableWidth);
			}
			return (
				<Box key={`before-${i}`}>
					<Text color={themeColors.secondary}>{lineNumStr} </Text>
					<Text wrap="truncate-end">{displayLine}</Text>
				</Box>
			);
		});

		// Build unified diff
		const diffLines: React.ReactElement[] = [];
		let oldIdx = 0;
		let newIdx = 0;
		let diffKey = 0;

		while (
			oldIdx < normalizedOldLines.length ||
			newIdx < normalizedNewLines.length
		) {
			const oldLine =
				oldIdx < normalizedOldLines.length ? normalizedOldLines[oldIdx] : null;
			const newLine =
				newIdx < normalizedNewLines.length ? normalizedNewLines[newIdx] : null;

			if (oldLine !== null && newLine !== null && oldLine === newLine) {
				const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');
				diffLines.push(
					<Box key={`diff-${diffKey++}`}>
						<Text color={themeColors.secondary}>{lineNumStr} </Text>
						<Text wrap="truncate-end">
							{truncateLine(oldLine, availableWidth)}
						</Text>
					</Box>,
				);
				oldIdx++;
				newIdx++;
			} else if (
				oldLine !== null &&
				newLine !== null &&
				areLinesSimlar(oldLine, newLine)
			) {
				const truncatedOldLine = truncateLine(oldLine, availableWidth);
				const truncatedNewLine = truncateLine(newLine, availableWidth);
				const segments = computeInlineDiff(truncatedOldLine, truncatedNewLine);
				const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');

				const oldParts = segments
					.filter(seg => seg.type === 'unchanged' || seg.type === 'removed')
					.map((seg, s) => (
						<Text
							key={`old-seg-${s}`}
							bold={seg.type === 'removed'}
							underline={seg.type === 'removed'}
						>
							{seg.text}
						</Text>
					));

				diffLines.push(
					<Box key={`diff-${diffKey++}`}>
						<Text
							backgroundColor={themeColors.diffRemoved}
							color={themeColors.diffRemovedText}
						>
							{lineNumStr} -
						</Text>
						<Text
							wrap="truncate-end"
							backgroundColor={themeColors.diffRemoved}
							color={themeColors.diffRemovedText}
						>
							{oldParts}
						</Text>
					</Box>,
				);

				const newParts = segments
					.filter(seg => seg.type === 'unchanged' || seg.type === 'added')
					.map((seg, s) => (
						<Text
							key={`new-seg-${s}`}
							bold={seg.type === 'added'}
							underline={seg.type === 'added'}
						>
							{seg.text}
						</Text>
					));

				diffLines.push(
					<Box key={`diff-${diffKey++}`}>
						<Text
							backgroundColor={themeColors.diffAdded}
							color={themeColors.diffAddedText}
						>
							{lineNumStr} +
						</Text>
						<Text
							wrap="truncate-end"
							backgroundColor={themeColors.diffAdded}
							color={themeColors.diffAddedText}
						>
							{newParts}
						</Text>
					</Box>,
				);

				oldIdx++;
				newIdx++;
			} else if (oldLine !== null) {
				const lineNumStr = String(startLine + oldIdx).padStart(4, ' ');
				diffLines.push(
					<Box key={`diff-${diffKey++}`}>
						<Text
							backgroundColor={themeColors.diffRemoved}
							color={themeColors.diffRemovedText}
						>
							{lineNumStr} -
						</Text>
						<Text
							wrap="truncate-end"
							backgroundColor={themeColors.diffRemoved}
							color={themeColors.diffRemovedText}
						>
							{truncateLine(oldLine, availableWidth)}
						</Text>
					</Box>,
				);
				oldIdx++;
			} else if (newLine !== null) {
				const lineNumStr = String(startLine + newIdx).padStart(4, ' ');
				diffLines.push(
					<Box key={`diff-${diffKey++}`}>
						<Text
							backgroundColor={themeColors.diffAdded}
							color={themeColors.diffAddedText}
						>
							{lineNumStr} +
						</Text>
						<Text
							wrap="truncate-end"
							backgroundColor={themeColors.diffAdded}
							color={themeColors.diffAddedText}
						>
							{truncateLine(newLine, availableWidth)}
						</Text>
					</Box>,
				);
				newIdx++;
			}
		}

		// Render context after
		const lineDelta = newStrLines.length - oldStrLines.length;
		const contextAfter = normalizedContextAfter.map((line, i) => {
			const actualLineNum = endLine + i;
			const lineNumStr = String(actualLineNum + lineDelta + 1).padStart(4, ' ');
			let displayLine: string;
			try {
				displayLine = truncateAnsi(
					highlight(line, {language, theme: 'default'}),
					availableWidth,
				);
			} catch {
				displayLine = truncateLine(line, availableWidth);
			}
			return (
				<Box key={`after-${i}`}>
					<Text color={themeColors.secondary}>{lineNumStr} </Text>
					<Text wrap="truncate-end">{displayLine}</Text>
				</Box>
			);
		});

		const rangeDesc =
			startLine === endLine
				? `line ${startLine}`
				: `lines ${startLine}-${endLine}`;

		return (
			<ToolMessage
				message={
					<Box flexDirection="column">
						<Text color={themeColors.tool}>⚒ string_replace</Text>
						<Box>
							<Text color={themeColors.secondary}>Path: </Text>
							<Text wrap="truncate-end" color={themeColors.primary}>
								{path}
							</Text>
						</Box>
						<Box>
							<Text color={themeColors.secondary}>Location: </Text>
							<Text color={themeColors.text}>{rangeDesc}</Text>
						</Box>
						<Box flexDirection="column" marginTop={1} marginBottom={1}>
							<Text color={themeColors.success}>
								{isResult ? '✓ Replace completed' : '✓ Replacing'}{' '}
								{oldStrLines.length} line{oldStrLines.length > 1 ? 's' : ''}{' '}
								with {newStrLines.length} line
								{newStrLines.length > 1 ? 's' : ''}
							</Text>
							<Box flexDirection="column">
								{contextBefore}
								{diffLines}
								{contextAfter}
							</Box>
						</Box>
					</Box>
				}
				hideBox={true}
			/>
		);
	} catch (error) {
		return (
			<ToolMessage
				message={
					<Box flexDirection="column">
						<Text color={themeColors.tool}>⚒ string_replace</Text>
						<Box>
							<Text color={themeColors.secondary}>Path: </Text>
							<Text wrap="truncate-end" color={themeColors.primary}>
								{path}
							</Text>
						</Box>
						<Box>
							<Text color={themeColors.error}>Error: </Text>
							<Text color={themeColors.error}>
								{error instanceof Error ? error.message : String(error)}
							</Text>
						</Box>
					</Box>
				}
				hideBox={true}
			/>
		);
	}
}
