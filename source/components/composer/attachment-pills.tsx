import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';
import type {ImageAttachment} from '@/types/core';

/** The pending image attachments, shown under the prompt box. */
export function AttachmentPills({
	attachments,
}: {
	attachments: ImageAttachment[];
}) {
	const {colors} = useTheme();
	return (
		<Box marginTop={1}>
			<Text color={colors.info}>
				{attachments
					.map((img, i) => `[image #${i + 1}: ${img.source ?? 'image'}]`)
					.join(' ')}
			</Text>
			<Text color={colors.secondary}> · Ctrl+X remove last</Text>
		</Box>
	);
}
