import {Box, Text} from 'ink';
import {memo} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {UserMessageProps} from '@/types/index';

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

export default memo(function UserMessage({message}: UserMessageProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();

	// Strip VS Code context blocks from display
	const displayMessage = stripVSCodeContext(message);
	const lines = displayMessage.split('\n');

	return (
		<Box
			flexDirection="column"
			marginBottom={2}
			backgroundColor={colors.base}
			width={boxWidth}
			paddingY={1}
			paddingLeft={1}
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
						lineIndex + 1 < lines.length && lines[lineIndex + 1].trim() === '';

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
	);
});
