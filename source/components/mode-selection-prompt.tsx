/**
 * Mode Selection Prompt Component
 *
 * Interactive keyboard-navigable prompt for selecting development mode
 * after plan completion. Similar to Claude Code's mode selection prompts.
 */

import {Box, Text, useInput} from 'ink';
import {useCallback, useState} from 'react';
import type {DevelopmentMode} from '@/types/core';

interface ModeSelectionPromptProps {
	onSelect: (mode: DevelopmentMode) => void;
	onModify?: () => void;
	onCancel?: () => void;
	planContent?: string;
}

const MODE_OPTIONS: Array<{
	mode: DevelopmentMode;
	label: string;
	description: string;
	emoji: string;
}> = [
	{
		mode: 'normal',
		label: 'Normal Mode',
		description: 'Confirm each tool before execution',
		emoji: '✓',
	},
	{
		mode: 'auto-accept',
		label: 'Auto-Accept Mode',
		description: 'Automatically execute all tools',
		emoji: '⚡',
	},
];

function ModeSelectionPrompt({
	onSelect,
	onModify,
	onCancel,
	planContent,
}: ModeSelectionPromptProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);

	const handleSelect = useCallback(() => {
		const selectedOption = MODE_OPTIONS[selectedIndex];
		if (selectedOption.mode === ('modify' as unknown as DevelopmentMode)) {
			onModify?.();
		} else {
			onSelect(selectedOption.mode);
		}
	}, [selectedIndex, onSelect, onModify]);

	const handleCancel = useCallback(() => {
		onCancel?.();
	}, [onCancel]);

	useInput((_input, key) => {
		if (key.upArrow) {
			const optionCount = MODE_OPTIONS.length + (onModify ? 1 : 0);
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : optionCount - 1));
		} else if (key.downArrow) {
			const optionCount = MODE_OPTIONS.length + (onModify ? 1 : 0);
			setSelectedIndex(prev => (prev < optionCount - 1 ? prev + 1 : 0));
		} else if (key.return) {
			handleSelect();
		} else if (key.escape) {
			handleCancel();
		}
	});

	// Combine mode options with modify option
	const allOptions = [...MODE_OPTIONS];
	if (onModify) {
		allOptions.push({
			mode: 'modify' as unknown as DevelopmentMode,
			label: 'Modify Plan',
			description: 'Return to plan mode to refine the plan',
			emoji: '✎',
		});
	}

	const getOptionEmoji = (index: number) => {
		if (index < MODE_OPTIONS.length) {
			return MODE_OPTIONS[index].emoji;
		}
		return '✎';
	};

	return (
		<Box flexDirection="column" marginTop={1} paddingX={1}>
			<Box>
				<Text bold color="#00ff00">
					{'▶'}
				</Text>
				<Text color="#00ff00">{' Plan Approval Required'}</Text>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>
					Review the plan and select an action (↑/↓ to navigate, Enter to
					select, Esc to cancel):
				</Text>
			</Box>

			{/* Plan preview (truncated) */}
			{planContent && (
				<Box marginTop={1} flexDirection="column">
					<Text color="#00ffff" dimColor>
						Plan Preview:
					</Text>
					<Box
						paddingLeft={1}
						paddingY={1}
						borderColor="#333333"
						borderStyle="round"
					>
						{planContent
							.split('\n')
							.slice(0, 8)
							.map((line, index) => (
								<Box key={index}>
									<Text dimColor color="#666666">
										{String(index + 1).padStart(4, ' ')}{' '}
									</Text>
									<Text wrap="wrap" dimColor>
										{line || ' '}
									</Text>
								</Box>
							))}
						{planContent.split('\n').length > 8 && (
							<Text dimColor color="#888888">
								... ({planContent.split('\n').length - 8} more lines)
							</Text>
						)}
					</Box>
				</Box>
			)}

			{/* Action options */}
			<Box flexDirection="column" marginTop={1}>
				{allOptions.map((option, index) => {
					const isSelected = index === selectedIndex;
					const optionEmoji = getOptionEmoji(index);
					return (
						<Box key={option.label}>
							<Text bold={isSelected} color={isSelected ? '#00ff00' : 'white'}>
								{isSelected ? '▸ ' : '  '}
								{optionEmoji} {option.label}
							</Text>
							{isSelected && (
								<Text dimColor>
									{' - '}
									{option.description}
								</Text>
							)}
						</Box>
					);
				})}
			</Box>
		</Box>
	);
}

export default ModeSelectionPrompt;
