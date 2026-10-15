import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import {FilterableSelectList} from '@/components/filterable-select-list';
import type {ItemSelectorOption} from '@/components/item-selector';
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

	// Escape belongs to FilterableSelectList once the list is up (Ink useInput
	// is broadcast, so a second active handler would cancel twice). Only the
	// confirmation step and the empty state need their own keys.
	useInput(
		(inputChar, key) => {
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
		},
		{isActive: awaitingBackupConfirmation || checkpoints.length === 0},
	);

	const handleCheckpointSelect = (name: string) => {
		setSelectedCheckpoint(name);
		if (currentMessageCount > 0) {
			setAwaitingBackupConfirmation(true);
		} else {
			onSelect(name, false);
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
						<Text color={colors.secondary}>
							Press Y/Enter to backup, N to skip, or Esc to cancel
						</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	const options: ItemSelectorOption[] = checkpoints.map(checkpoint => ({
		label: `${checkpoint.name} - ${checkpoint.metadata.messageCount} msgs, ${
			checkpoint.metadata.filesChanged.length
		} files - ${formatRelativeTime(checkpoint.metadata.timestamp)}`,
		value: checkpoint.name,
		// Filter on the name alone: the counts and age suffix would match most
		// queries, the same reason the session list filters on its title.
		searchText: checkpoint.name,
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
				<FilterableSelectList
					items={options}
					onSelect={handleCheckpointSelect}
					onCancel={onCancel}
					visibleCount={10}
				/>
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Type to filter • ↑/↓ to navigate • Enter to select • Esc to cancel
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
