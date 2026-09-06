import {Box, Text, useInput} from 'ink';
import {useState} from 'react';
import {StyledSelectInput} from '@/components/ui/styled-select-input';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';

export interface ArchitectReviewPromptProps {
	/** Keep the changes made during the Architect turn. */
	onKeep: () => void;
	/** Revert the changes made during the Architect turn. */
	onRevert: () => void;
	/** Revert the changes and ask the model to revise them. */
	onRevertAndRevise: () => void;
	/** Dismiss the review prompt without taking an action. */
	onDismiss: () => void;
	/** Files changed during the Architect turn. */
	filesChanged: string[];
	/** Files that did not exist before the Architect turn. */
	filesMissing: string[];
}

type ArchitectAction = 'keep' | 'revert' | 'revertAndRevise';

interface ArchitectOption {
	label: string;
	value: ArchitectAction;
	description: string;
}

const OPTIONS: ArchitectOption[] = [
	{
		label: 'Keep',
		value: 'keep',
		description: 'Keep all changes made during this Architect turn',
	},
	{
		label: 'Revert',
		value: 'revert',
		description: 'Restore the files to their state before this turn',
	},
	{
		label: 'Revert & Revise',
		value: 'revertAndRevise',
		description: 'Restore the files and ask the model to revise its changes',
	},
];

export default function ArchitectReviewPrompt({
	onKeep,
	onRevert,
	onRevertAndRevise,
	onDismiss,
	filesChanged,
	filesMissing,
}: ArchitectReviewPromptProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const [highlighted, setHighlighted] = useState<ArchitectAction>('keep');

	useInput((_input, key) => {
		if (key.escape) {
			onDismiss();
		}
	});

	const handleSelect = (item: {value: ArchitectAction}) => {
		if (item.value === 'keep') {
			onKeep();
		} else if (item.value === 'revert') {
			onRevert();
		} else {
			onRevertAndRevise();
		}
	};

	const activeDescription =
		OPTIONS.find(option => option.value === highlighted)?.description ?? '';

	return (
		<Box
			flexDirection="column"
			marginTop={1}
			marginBottom={1}
			padding={1}
			width={boxWidth}
			borderStyle="bold"
			borderLeft={true}
			borderRight={false}
			borderTop={false}
			borderBottom={false}
			borderLeftColor={colors.primary}
		>
			<Box marginBottom={1}>
				<Text color={colors.primary} bold>
					Architect turn complete.{' '}
				</Text>
				<Text color={colors.secondary}>
					Review the changes before continuing.
				</Text>
			</Box>

			<Box flexDirection="column" marginBottom={1}>
				<Text color={colors.secondary} bold>
					Changed files: {filesChanged.length}
				</Text>

				{filesChanged.map(file => (
					<Text key={file} color={colors.secondary}>
						{'  '}
						{file}
					</Text>
				))}

				{filesMissing.length > 0 && (
					<Box flexDirection="column" marginTop={1}>
						<Text color={colors.secondary} bold>
							New files: {filesMissing.length}
						</Text>

						{filesMissing.map(file => (
							<Text key={file} color={colors.secondary}>
								{'  '}
								{file}
							</Text>
						))}
					</Box>
				)}
			</Box>

			<StyledSelectInput
				items={OPTIONS}
				onSelect={handleSelect}
				onHighlight={item => setHighlighted(item.value)}
			/>

			<Box marginTop={1}>
				<Text color={colors.secondary} italic wrap="wrap">
					{activeDescription}
				</Text>
			</Box>

			<Box marginTop={1}>
				<Text color={colors.secondary}>
					↑/↓ to move · Enter to select · Esc to dismiss
				</Text>
			</Box>
		</Box>
	);
}
