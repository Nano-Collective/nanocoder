import {Box, Text, useInput} from 'ink';
import SelectInput from 'ink-select-input';
import {useRef, useState} from 'react';
import TextInput from '@/components/text-input';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {PendingQuestion} from '@/utils/question-queue';
import {ensureString} from '@/utils/type-helpers';

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

	// Reset internal state whenever a new question arrives. When two
	// ask_user calls fire back-to-back, React batches the null->new state
	// transition so this component re-renders with new props instead of
	// unmounting, leaving stale `answeredRef` (which silently blocks
	// submission) and stale freeform state. The SelectInput `key` below
	// handles its own internal selected-index reset.
	const [previousQuestion, setPreviousQuestion] = useState(question);
	if (question !== previousQuestion) {
		setPreviousQuestion(question);
		answeredRef.current = false;
		setIsFreeformMode(false);
		setFreeformValue('');
	}

	// Build option items for SelectInput. The model controls `options`, so it
	// may not be an array of strings — coerce so a malformed call can't crash.
	const safeOptions = Array.isArray(question.options) ? question.options : [];
	const items: OptionItem[] = safeOptions.map(opt => {
		const label = ensureString(opt);
		return {label, value: label};
	});

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
				<Text color={colors.text}> {ensureString(question.question)}</Text>
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
					<SelectInput
						key={question.question}
						items={items}
						onSelect={handleSelect}
					/>
					<Box marginTop={1}>
						<Text color={colors.secondary}>Press Escape to cancel</Text>
					</Box>
				</Box>
			)}
		</Box>
	);
}
