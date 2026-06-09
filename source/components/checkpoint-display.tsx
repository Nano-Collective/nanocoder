import {Box, Text} from 'ink';
import {useTheme} from '@/hooks/useTheme';
import type {CheckpointListItem} from '@/types/checkpoint';
import {formatRelativeTime} from '@/utils/checkpoint-utils';

interface CheckpointListDisplayProps {
	checkpoints: CheckpointListItem[];
	title?: string;
}

export function CheckpointListDisplay({
	checkpoints,
	title = 'Available Checkpoints',
}: CheckpointListDisplayProps) {
	const {colors} = useTheme();

	const formatSize = (bytes?: number): string => {
		if (!bytes) return '';

		const kb = bytes / 1024;
		const mb = kb / 1024;

		if (mb >= 1) {
			return `${mb.toFixed(1)}MB`;
		} else if (kb >= 1) {
			return `${kb.toFixed(0)}KB`;
		} else {
			return `${bytes}B`;
		}
	};

	if (checkpoints.length === 0) {
		return (
			<Box flexDirection="column" marginY={1}>
				<Text color={colors.secondary}>
					No checkpoints found. Create one with /checkpoint create [name]
				</Text>
			</Box>
		);
	}

	return (
		<Box flexDirection="column" marginY={1}>
			<Box
				borderStyle="round"
				borderColor={colors.primary}
				paddingX={2}
				paddingY={1}
			>
				<Box flexDirection="column">
					<Text bold color={colors.primary}>
						{title}
					</Text>
					<Box marginTop={1} flexDirection="column">
						{/* Header */}
						<Box flexDirection="row">
							<Box width={20}>
								<Text bold color={colors.info}>
									Name
								</Text>
							</Box>
							<Box width={15}>
								<Text bold color={colors.info}>
									Created
								</Text>
							</Box>
							<Box width={10}>
								<Text bold color={colors.info}>
									Messages
								</Text>
							</Box>
							<Box width={8}>
								<Text bold color={colors.info}>
									Files
								</Text>
							</Box>
							<Box width={8}>
								<Text bold color={colors.info}>
									Size
								</Text>
							</Box>
						</Box>

						{/* Separator */}
						<Box>
							<Text color={colors.secondary}>{'─'.repeat(50)}</Text>
						</Box>

						{/* Rows */}
						{checkpoints.map(checkpoint => {
							const isTrigger = checkpoint.metadata.provider.name === 'trigger';
							return (
								<Box key={checkpoint.name} flexDirection="column">
									<Box flexDirection="row">
										<Box width={20}>
											<Text color={colors.text}>
												{checkpoint.name.length > 18
													? checkpoint.name.substring(0, 15) + '...'
													: checkpoint.name}
											</Text>
										</Box>
										<Box width={15}>
											<Text color={colors.secondary}>
												{formatRelativeTime(checkpoint.metadata.timestamp)}
											</Text>
										</Box>
										<Box width={10}>
											<Text color={colors.text}>
												{checkpoint.metadata.messageCount}
											</Text>
										</Box>
										<Box width={8}>
											<Text color={colors.text}>
												{checkpoint.metadata.filesChanged.length}
											</Text>
										</Box>
										<Box width={8}>
											<Text color={colors.secondary}>
												{formatSize(checkpoint.sizeBytes)}
											</Text>
										</Box>
									</Box>
									{isTrigger && (
										<Box marginLeft={2}>
											<Text color={colors.secondary}>
												↳ {checkpoint.metadata.provider.model}
											</Text>
										</Box>
									)}
								</Box>
							);
						})}
					</Box>
				</Box>
			</Box>
		</Box>
	);
}
