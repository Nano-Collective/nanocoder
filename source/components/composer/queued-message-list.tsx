import {Box, Text} from 'ink';
import stringWidth from 'string-width';
import {useTheme} from '@/hooks/useTheme';
import type {QueuedUserMessage} from '@/hooks/useUserMessageQueue';

// Columns a queued-message row loses inside the prompt box: the rounded
// border (2), paddingX (2), and the '▸ '/'  ' selection marker (2).
const QUEUED_ROW_OVERHEAD = 6;

/**
 * One queued message as a single row that fits the prompt box: whitespace
 * collapsed, truncated to the box width, with an image-count suffix. Budget
 * against the box the row renders in, not the terminal, or it wraps.
 */
export function formatQueuedRow(
	message: QueuedUserMessage,
	promptWidth: number,
	truncate: (text: string, maxLength: number) => string,
): string {
	const imageSuffix =
		message.images && message.images.length > 0
			? ` (${message.images.length} image${message.images.length === 1 ? '' : 's'})`
			: '';
	const singleLine = message.displayValue.replace(/\s+/g, ' ').trim();
	const maxLength = Math.max(
		8,
		promptWidth - QUEUED_ROW_OVERHEAD - stringWidth(imageSuffix),
	);
	// cli-truncate can overshoot by a column when the cut falls inside a
	// double-width character, so re-truncate until it really fits.
	let text = truncate(singleLine, maxLength);
	for (
		let budget = maxLength - 1;
		stringWidth(text) > maxLength && budget > 0;
		budget--
	) {
		text = truncate(singleLine, budget);
	}
	return `${text}${imageSuffix}`;
}

/** The queued messages inside the prompt box, with the selected one marked. */
export function QueuedMessageList({
	messages,
	selectedIndex,
	promptWidth,
	truncate,
}: {
	messages: QueuedUserMessage[];
	selectedIndex: number;
	promptWidth: number;
	truncate: (text: string, maxLength: number) => string;
}) {
	const {colors} = useTheme();
	return (
		<Box flexDirection="column" marginTop={1}>
			<Text color={colors.secondary}>
				Queued messages (↑/↓ select, Enter edit, Del remove):
			</Text>
			{messages.map((message, index) => {
				const isSelected = index === selectedIndex;
				return (
					<Text
						key={message.id}
						color={isSelected ? colors.info : colors.primary}
						bold={isSelected}
					>
						{isSelected ? '▸ ' : '  '}
						{formatQueuedRow(message, promptWidth, truncate)}
					</Text>
				);
			})}
		</Box>
	);
}
