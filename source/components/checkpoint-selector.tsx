import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useState} from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {CheckpointListItem} from '@/types/checkpoint';
import {formatRelativeTime} from '@/utils/checkpoint-utils';

interface CheckpointSelectorProps {
	checkpoints: CheckpointListItem[];
	onSelect: (checkpointName: string, createBackup: boolean) => void;
	onCancel: () => void;
	onError?: (error: Error) => void;
	currentMessageCount: number;
}

interface CheckpointOption {
	label: string;
	value: string;
}

export default function CheckpointSelector({
	checkpoints,
	onSelect,
	onCancel,
	currentMessageCount,
}: CheckpointSelectorProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [selectedCheckpoint, setSelectedCheckpoint] = useState<string | null>(
		null,
	);
	const [awaitingBackupConfirmation, setAwaitingBackupConfirmation] =
		useState(false);

	useInput((inputChar, key) => {
		if (key.escape) {
			onCancel();
			return;
		}

		if (awaitingBackupConfirmation) {
			const char = inputChar.toLowerCase();
			if (char === 'y' || char === '\r' || char === '\n') {
				if (selectedCheckpoint) {
					onSelect(selectedCheckpoint, true);
				}
			} else if (char === 'n') {
				if (selectedCheckpoint) {
					onSelect(selectedCheckpoint, false);
				}
			}
		}
	});

	const handleCheckpointSelect = (item: CheckpointOption) => {
		setSelectedCheckpoint(item.value);
		if (currentMessageCount > 0) {
			setAwaitingBackupConfirmation(true);
		} else {
			onSelect(item.value, false);
		}
	};

	if (awaitingBackupConfirmation && selectedCheckpoint) {
		const checkpoint = checkpoints.find(c => c.name === selectedCheckpoint);

		return (
			<TitledBoxWithPreferences
				title="Checkpoint Load - Backup Confirmation"
				width={boxWidth}
				borderColor={colors.warning}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Box marginBottom={1}>
						<Text color={colors.text}>
							You have {currentMessageCount} message(s) in the current session.
						</Text>
					</Box>

					{checkpoint && (
						<Box flexDirection="column" marginBottom={1}>
							<Text color={colors.secondary}>
								Loading checkpoint:{' '}
								<Text color={colors.primary}>{checkpoint.name}</Text>
							</Text>
							<Text color={colors.secondary}>
								• {checkpoint.metadata.messageCount} messages
							</Text>
							<Text color={colors.secondary}>
								• {checkpoint.metadata.filesChanged.length} files
							</Text>
							<Text color={colors.secondary}>
								• Created {formatRelativeTime(checkpoint.metadata.timestamp)}
							</Text>
						</Box>
					)}

					<Box marginBottom={1}>
						<Text color={colors.warning} bold>
							Create a backup of current session before loading?
						</Text>
					</Box>

					<Box marginBottom={1}>
						<Text color={colors.text}>
							[Y] Yes, create backup [N] No, skip backup [Esc] Cancel
						</Text>
					</Box>

					<Box>
						<Text color={colors.secondary} dimColor>
							Press Y/Enter to backup, N to skip, or Esc to cancel
						</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	const options: CheckpointOption[] = checkpoints.map(checkpoint => ({
		label: `${checkpoint.name} - ${checkpoint.metadata.messageCount} msgs, ${
			checkpoint.metadata.filesChanged.length
		} files - ${formatRelativeTime(checkpoint.metadata.timestamp)}`,
		value: checkpoint.name,
	}));

	if (options.length === 0) {
		return (
			<TitledBoxWithPreferences
				title="No Checkpoints Available"
				width={boxWidth}
				borderColor={colors.secondary}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Text color={colors.text}>
						No checkpoints found. Create one with /checkpoint create [name]
					</Text>
					<Box marginTop={1}>
						<Text color={colors.secondary}>Press Escape to cancel</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	return (
		<TitledBoxWithPreferences
			title="Select Checkpoint to Load"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<SelectInput items={options} onSelect={handleCheckpointSelect} />
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Use ↑↓ arrows to select, Enter to confirm, Escape to cancel
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
