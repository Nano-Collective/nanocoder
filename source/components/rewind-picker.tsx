import {Box, Text} from 'ink';
import {useState} from 'react';
import {FilterableSelectList} from '@/components/filterable-select-list';
import type {ItemSelectorOption} from '@/components/item-selector';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {RewindMode, RewindPoint} from '@/services/rewind';
import {promptTitle} from '@/services/rewind';

interface RewindPickerProps {
	points: RewindPoint[];
	onSelect: (point: RewindPoint, mode: RewindMode) => void;
	onCancel: () => void;
	currentMessageCount: number;
}

const MODES: Array<{value: RewindMode; label: string}> = [
	{value: 'both', label: 'Restore code and conversation'},
	{value: 'conversation', label: 'Restore conversation only'},
	{value: 'files', label: 'Restore code only'},
];

function filesLabel(count: number): string {
	if (count === 0) return 'no file changes';
	return `${count} file${count === 1 ? '' : 's'}`;
}

/**
 * Two steps in one live component: pick a prompt, then pick what to restore.
 * The second step exists because restoring the files without the messages (and
 * the reverse) are both wanted often enough to be their own choice.
 */
export default function RewindPicker({
	points,
	onSelect,
	onCancel,
	currentMessageCount,
}: RewindPickerProps) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();
	const [selected, setSelected] = useState<RewindPoint | null>(null);

	if (selected) {
		const options: ItemSelectorOption[] = MODES.map(mode => ({
			label: mode.label,
			value: mode.value,
			searchText: mode.label,
		}));

		return (
			<TitledBoxWithPreferences
				title="Rewind - What to Restore"
				width={boxWidth}
				borderColor={colors.warning}
				paddingX={2}
				paddingY={1}
				marginBottom={1}
			>
				<Box flexDirection="column">
					<Box marginBottom={1} flexDirection="column">
						<Text color={colors.secondary}>
							Prompt:{' '}
							<Text color={colors.text}>
								{promptTitle(selected.promptText)}
							</Text>
						</Text>
						<Text color={colors.secondary}>
							{filesLabel(selected.files.length)} restored •{' '}
							{filesLabel(selected.createdFiles.length)} deleted •{' '}
							{Math.max(0, currentMessageCount - selected.messageIndex)}{' '}
							message(s) will be removed
						</Text>
					</Box>

					<FilterableSelectList
						items={options}
						onSelect={value => onSelect(selected, value as RewindMode)}
						onCancel={() => setSelected(null)}
						visibleCount={5}
					/>

					<Box marginTop={1} flexDirection="column">
						<Text color={colors.secondary}>
							↑/↓ to choose • Enter to restore • Esc to go back
						</Text>
						<Text color={colors.warning}>
							Bash side effects are not undone.
						</Text>
					</Box>
				</Box>
			</TitledBoxWithPreferences>
		);
	}

	const options: ItemSelectorOption[] = points.map(point => {
		const changed = point.files.length + point.createdFiles.length;
		return {
			label: `${promptTitle(point.promptText) || '(empty prompt)'} · ${filesLabel(
				changed,
			)}${point.createdFiles.length > 0 ? ` (${point.createdFiles.length} deleted)` : ''}`,
			value: point.entry.id,
			searchText: point.promptText,
		};
	});

	return (
		<TitledBoxWithPreferences
			title="Rewind to Before a Prompt"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			marginBottom={1}
		>
			<Box flexDirection="column">
				<FilterableSelectList
					items={options}
					onSelect={value => {
						const point = points.find(
							candidate => candidate.entry.id === value,
						);
						if (point) setSelected(point);
					}}
					onCancel={onCancel}
					visibleCount={10}
				/>
				<Box marginTop={1}>
					<Text color={colors.secondary}>
						Newest first • type to filter • ↑/↓ to navigate • Enter to select •
						Esc to cancel
					</Text>
				</Box>
			</Box>
		</TitledBoxWithPreferences>
	);
}
