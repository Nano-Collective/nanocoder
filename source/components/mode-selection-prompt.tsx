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
	onCancel?: () => void;
}

const MODE_OPTIONS: Array<{
	mode: DevelopmentMode;
	label: string;
	description: string;
}> = [
	{
		mode: 'normal',
		label: 'Normal Mode',
		description: 'Confirm each tool before execution',
	},
	{
		mode: 'auto-accept',
		label: 'Auto-Accept Mode',
		description: 'Automatically execute all tools',
	},
];

export function ModeSelectionPrompt({
	onSelect,
	onCancel,
}: ModeSelectionPromptProps) {
	const [selectedIndex, setSelectedIndex] = useState(0);

	const handleSelect = useCallback(() => {
		const selectedMode = MODE_OPTIONS[selectedIndex].mode;
		onSelect(selectedMode);
	}, [selectedIndex, onSelect]);

	const handleCancel = useCallback(() => {
		onCancel?.();
	}, [onCancel]);

	useInput((input, key) => {
		if (key.upArrow) {
			setSelectedIndex(prev => (prev > 0 ? prev - 1 : MODE_OPTIONS.length - 1));
		} else if (key.downArrow) {
			setSelectedIndex(prev => (prev < MODE_OPTIONS.length - 1 ? prev + 1 : 0));
		} else if (key.return) {
			handleSelect();
		} else if (key.escape) {
			handleCancel();
		}
	});

	return (
		<Box flexDirection="column" marginTop={1} paddingX={1}>
			<Box>
				<Text bold color="#00ff00">
					{'▶'}
				</Text>
				<Text color="#00ff00">{' Plan Complete! '}</Text>
			</Box>
			<Box marginTop={1}>
				<Text dimColor>
					Select execution mode (↑/↓ to navigate, Enter to select, Esc to
					cancel):
				</Text>
			</Box>
			<Box flexDirection="column" marginTop={1}>
				{MODE_OPTIONS.map((option, index) => {
					const isSelected = index === selectedIndex;
					return (
						<Box key={option.mode}>
							<Text bold={isSelected} color={isSelected ? '#00ff00' : 'white'}>
								{isSelected ? '▸ ' : '  '}
								{option.label}
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
