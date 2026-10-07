import {Box, Text} from 'ink';
import {memo} from 'react';
import {useNonInteractiveRender} from '@/hooks/useNonInteractiveRender';
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

function getCollapsedPreview(message: string): string {
	const words = [...message.matchAll(/\S+/g)];
	const wordLimitEnd = words[COLLAPSE_WORD_LIMIT]?.index ?? message.length;
	const previewEnd = Math.min(COLLAPSE_CHAR_LIMIT, wordLimitEnd);

	return `${message.slice(0, previewEnd).trimEnd()}...`;
}

// Parse a line and return segments with file/image placeholders highlighted
function parseLineWithPlaceholders(line: string) {
	const segments: Array<{text: string; isPlaceholder: boolean}> = [];
	const filePattern = /\[@[^\]]+\]|\[Image #\d+\]/g;
	let lastIndex = 0;
	let match;

	while ((match = filePattern.exec(line)) !== null) {
		if (match.index > lastIndex) {
			segments.push({
				text: line.slice(lastIndex, match.index),
				isPlaceholder: false,
			});
		}

		segments.push({
			text: match[0],
			isPlaceholder: true,
		});

		lastIndex = match.index + match[0].length;
	}

	if (lastIndex < line.length) {
		segments.push({
			text: line.slice(lastIndex),
			isPlaceholder: false,
		});
	}

	return segments;
}

const COLLAPSE_WORD_LIMIT = 40;
const COLLAPSE_CHAR_LIMIT = 300;

export default memo(function UserMessage({
	message,
	tokenContent,
	imageCount = 0,
}: UserMessageProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const nonInteractive = useNonInteractiveRender();
	const tokens = calculateTokens(tokenContent ?? message);

	// Non-interactive (`run`) mode: the user already knows what prompt they
	// submitted — echoing it back as a boxed "You:" block is pure noise.
	if (nonInteractive) {
		return null;
	}

	// Inner text width: outer width minus left border (1) and padding (1 each side)
	const textWidth = boxWidth - 3;
	const strippedMessage = stripVSCodeContext(message);
	const wordCount = [...strippedMessage.matchAll(/\S+/g)].length;
	const isLongMessage =
		wordCount > COLLAPSE_WORD_LIMIT ||
		strippedMessage.length > COLLAPSE_CHAR_LIMIT;
	const visibleMessage = isLongMessage
		? getCollapsedPreview(strippedMessage)
		: strippedMessage;
	const displayMessage = wrapWithTrimmedContinuations(
		visibleMessage,
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
						// Skip empty lines — they create paragraph spacing via marginBottom.
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

			{isLongMessage && (
				<Box marginBottom={1}>
					<Text color={colors.secondary}>Full prompt: ↑ history</Text>
				</Box>
			)}

			{imageCount > 0 && (
				<Box marginBottom={1}>
					<Text color={colors.info}>
						■ {imageCount} image{imageCount === 1 ? '' : 's'} attached
					</Text>
				</Box>
			)}

			<Box marginBottom={2}>
				<Text color={colors.secondary}>~{tokens.toLocaleString()} tokens</Text>
			</Box>
		</>
	);
});
