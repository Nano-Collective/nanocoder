import {Box, Text, useInput} from 'ink';
import {useRef, useState} from 'react';
import TextInput from '@/components/text-input';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {PendingQuestion, QuestionOptionMeta} from '@/utils/question-queue';
import {ensureString} from '@/utils/type-helpers';

interface QuestionPromptProps {
	question: PendingQuestion;
	onAnswer: (answer: string) => void;
}

interface OptionItem {
	label: string;
	value: string;
	meta?: QuestionOptionMeta;
}

const TYPE_BADGE: Record<string, string> = {
	ambiguity: '❓',
	decision: '🔧',
	confirmation: '✋',
};

const FREEFORM_VALUE = '__freeform__';

export default function QuestionPrompt({
	question,
	onAnswer,
}: QuestionPromptProps) {
	const {colors} = useTheme();
	const boxWidth = useTerminalWidth();
	const answeredRef = useRef(false);
	const [isFreeformMode, setIsFreeformMode] = useState(false);
	const [freeformValue, setFreeformValue] = useState('');
	const [selectedIndex, setSelectedIndex] = useState(0);

	// Build option items. The model controls `options`, so it may not be an
	// array of strings — coerce so a malformed call can't crash.
	const safeOptions = Array.isArray(question.options) ? question.options : [];
	const items: OptionItem[] = safeOptions.map((opt, i) => {
		const label = ensureString(opt);
		return {label, value: label, meta: question.optionMeta?.[i]};
	});

	if (question.allowFreeform) {
		items.push({label: 'Type a custom answer…', value: FREEFORM_VALUE});
	}

	// Reset internal state whenever a new question arrives. When two ask_user
	// calls fire back-to-back, React batches the null->new state transition so
	// this component re-renders with new props instead of unmounting, leaving
	// stale state (answeredRef silently blocks submission; selection/freeform
	// carry over).
	const [previousQuestion, setPreviousQuestion] = useState(question);
	if (question !== previousQuestion) {
		setPreviousQuestion(question);
		answeredRef.current = false;
		setIsFreeformMode(false);
		setFreeformValue('');
		setSelectedIndex(0);
	}

	// Fix stale closures in useInput by keeping a ref to the latest state
	const stateRef = useRef({
		items,
		selectedIndex,
		isFreeformMode,
		onAnswer,
	});
	stateRef.current = {
		items,
		selectedIndex,
		isFreeformMode,
		onAnswer,
	};

	const submitAnswer = (answer: string) => {
		if (answeredRef.current) return;
		answeredRef.current = true;
		stateRef.current.onAnswer(answer);
	};

	const handleSelect = (item: OptionItem | undefined) => {
		if (!item) return;
		if (item.value === FREEFORM_VALUE) {
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

	useInput((input, key) => {
		const state = stateRef.current;
		// In freeform mode the TextInput owns typing; only handle Escape (back).
		if (state.isFreeformMode) {
			if (key.escape) {
				setIsFreeformMode(false);
				setFreeformValue('');
			}
			return;
		}

		if (key.escape) {
			submitAnswer('User declined to answer');
			return;
		}
		if (state.items.length === 0) return;

		if (key.upArrow || input === 'k') {
			setSelectedIndex(i => (i - 1 + state.items.length) % state.items.length);
		} else if (key.downArrow || input === 'j') {
			setSelectedIndex(i => (i + 1) % state.items.length);
		} else if (key.return) {
			handleSelect(state.items[state.selectedIndex]);
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
				{question.questionType && (
					<Text color={colors.secondary}>
						{TYPE_BADGE[question.questionType]}{' '}
					</Text>
				)}
				<Text color={colors.text}>{ensureString(question.question)}</Text>
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
					{items.map((item, index) => {
						const isSelected = index === selectedIndex;
						const isFreeform = item.value === FREEFORM_VALUE;
						const color = isSelected
							? colors.primary
							: isFreeform
								? colors.secondary
								: colors.text;
						const meta = item.meta;
						return (
							<Box
								key={item.value}
								flexDirection="column"
								width={boxWidth}
								marginBottom={1}
							>
								<Box flexDirection="row">
									<Box flexShrink={0} marginRight={1}>
										<Text color={colors.primary} bold>
											{isSelected ? '❯' : ' '}
										</Text>
									</Box>
									<Box flexGrow={1} flexShrink={1}>
										<Text wrap="wrap" color={color} bold={isSelected}>
											{item.label}
										</Text>
										{meta?.description && (
											<Text wrap="wrap" color={colors.secondary}>
												{' — '}
												{meta.description}
											</Text>
										)}
									</Box>
								</Box>
								{isSelected && meta?.pros && meta.pros.length > 0 && (
									<Box flexDirection="column" marginLeft={2}>
										{meta.pros.map(pro => (
											<Text key={pro} color="green">
												+ {pro}
											</Text>
										))}
										{meta.cons?.map(con => (
											<Text key={con} color="red">
												- {con}
											</Text>
										))}
									</Box>
								)}
							</Box>
						);
					})}
					<Text color={colors.secondary}>
						↑/↓ to move · Enter to select · Esc to cancel
					</Text>
				</Box>
			)}
		</Box>
	);
}
