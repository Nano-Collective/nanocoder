import {Box, Text} from 'ink';
import {memo} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {UserMessageProps} from '@/types/index';
import {wrapWithTrimmedContinuations} from '@/utils/text-wrapping';
import {calculateTokens} from '@/utils/token-calculator';

// Strip VS Code context blocks from display (code is still sent to LLM)
function stripVSCodeContext(message: string): string {
	return message.replace(
		/<!--vscode-context-->[\s\S]*?<!--\/vscode-context-->/g,
		'',
	);
}

// Parse a line and return segments with file placeholders highlighted
function parseLineWithPlaceholders(line: string) {
	const segments: Array<{text: string; isPlaceholder: boolean}> = [];
	const filePattern = /\[@[^\]]+\]/g;
	let lastIndex = 0;
	let match;

	while ((match = filePattern.exec(line)) !== null) {
		// Add text before the placeholder
		if (match.index > lastIndex) {
			segments.push({
				text: line.slice(lastIndex, match.index),
				isPlaceholder: false,
			});
		}

		// Add the placeholder
		segments.push({
			text: match[0],
			isPlaceholder: true,
		});

		lastIndex = match.index + match[0].length;
	}

	// Add remaining text
	if (lastIndex < line.length) {
		segments.push({
			text: line.slice(lastIndex),
			isPlaceholder: false,
		});
	}

	return segments;
}

export default memo(function UserMessage({
	message,
	tokenContent,
}: UserMessageProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const tokens = calculateTokens(tokenContent ?? message);

	// Inner text width: outer width minus left border (1) and padding (1 each side)
	const textWidth = boxWidth - 3;

	// Strip VS Code context blocks and pre-wrap to avoid Ink's trim:false
	// leaving leading spaces on wrapped lines
	const displayMessage = wrapWithTrimmedContinuations(
		stripVSCodeContext(message),
		textWidth,
	);
	const lines = displayMessage.split('\n');

	return (
		<>
			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					You:
				</Text>
			</Box>
			<Box
				flexDirection="column"
				marginBottom={1}
				backgroundColor={colors.base}
				width={boxWidth}
				padding={1}
				borderStyle="bold"
				borderLeft={true}
				borderRight={false}
				borderTop={false}
				borderBottom={false}
				borderLeftColor={colors.primary}
			>
				<Box flexDirection="column">
					{lines.map((line, lineIndex) => {
						// Skip empty lines - they create paragraph spacing via marginBottom
						if (line.trim() === '') {
							return null;
						}

						const segments = parseLineWithPlaceholders(line);
						const isEndOfParagraph =
							lineIndex + 1 < lines.length &&
							lines[lineIndex + 1].trim() === '';

						return (
							<Box key={lineIndex} marginBottom={isEndOfParagraph ? 1 : 0}>
								<Text>
									{segments.map((segment, segIndex) => (
										<Text
											key={segIndex}
											color={segment.isPlaceholder ? colors.info : colors.text}
											bold={segment.isPlaceholder}
										>
											{segment.text}
										</Text>
									))}
								</Text>
							</Box>
						);
					})}
				</Box>
			</Box>
			<Box marginBottom={2}>
				<Text color={colors.secondary}>~{tokens.toLocaleString()} tokens</Text>
			</Box>
		</>
	);
});
