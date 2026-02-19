import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import TextInput from 'ink-text-input';
import {useRef, useState} from 'react';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {PendingQuestion} from '@/utils/question-queue';

interface QuestionPromptProps {
	question: PendingQuestion;
	onAnswer: (answer: string) => void;
}

interface OptionItem {
	label: string;
	value: string;
}

export default function QuestionPrompt({
	question,
	onAnswer,
}: QuestionPromptProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const answeredRef = useRef(false);
	const [isFreeformMode, setIsFreeformMode] = useState(false);
	const [freeformValue, setFreeformValue] = useState('');

	// Build option items for SelectInput
	const items: OptionItem[] = question.options.map(opt => ({
		label: opt,
		value: opt,
	}));

	if (question.allowFreeform) {
		items.push({
			label: 'Type custom answer...',
			value: '__freeform__',
		});
	}

	const submitAnswer = (answer: string) => {
		if (answeredRef.current) return;
		answeredRef.current = true;
		onAnswer(answer);
	};

	const handleSelect = (item: OptionItem) => {
		if (item.value === '__freeform__') {
			setIsFreeformMode(true);
			return;
		}
		submitAnswer(item.value);
	};

	const handleFreeformSubmit = (value: string) => {
		if (value.trim()) {
			submitAnswer(value.trim());
		}
	};

	// Handle escape to cancel (resolves with decline message)
	useInput((_input, key) => {
		if (key.escape) {
			if (isFreeformMode) {
				// Go back to option selection
				setIsFreeformMode(false);
				setFreeformValue('');
			} else {
				submitAnswer('User declined to answer');
			}
		}
	});

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Box
				flexDirection="row"
				marginBottom={1}
				backgroundColor={colors.base}
				width={boxWidth}
				padding={1}
				borderStyle="bold"
				borderLeft={true}
				borderRight={false}
				borderTop={false}
				borderBottom={false}
				borderLeftColor={colors.secondary}
			>
				<Text color={colors.tool} bold>
					?
				</Text>
				<Text color={colors.text}> {question.question}</Text>
			</Box>

			{isFreeformMode ? (
				<Box flexDirection="column">
					<Box>
						<Text color={colors.secondary}>{'> '}</Text>
						<TextInput
							value={freeformValue}
							onChange={setFreeformValue}
							onSubmit={handleFreeformSubmit}
						/>
					</Box>
					<Box marginTop={1}>
						<Text color={colors.secondary}>
							Press Enter to submit, Escape to go back
						</Text>
					</Box>
				</Box>
			) : (
				<Box flexDirection="column">
					<SelectInput items={items} onSelect={handleSelect} />
					<Box marginTop={1}>
						<Text color={colors.secondary}>Press Escape to cancel</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
