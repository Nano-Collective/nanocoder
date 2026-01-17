/**
 * Interactive Question Prompt Component
 *
 * Interactive keyboard-navigable prompt for asking the user questions.
 * Supports multiple questions, single/multi-select options, and custom input.
 * Compatible with Claude Code's AskUserQuestion schema.
 */

import {Box, Text, useInput, useStdin} from 'ink';
import {useCallback, useEffect, useState} from 'react';
import type {Question, QuestionOption} from '@/utils/question-selection-registry';

interface InteractiveQuestionPromptProps {
	questions: Question[];
	onSubmit: (answers: Record<string, string>) => void;
	onCancel: () => void;
}

interface Answer {
	questionIndex: number;
	selectedOptions: number[]; // For multi-select, can have multiple selections
	customInput?: string; // For "Other" option
}

/**
 * Single question display and selection
 */
function SingleQuestion({
	question,
	questionIndex,
	isActive,
	selectedIndices,
	customInput,
	onSelect,
	onCustomInput,
}: {
	question: Question;
	questionIndex: number;
	isActive: boolean;
	selectedIndices: number[];
	customInput?: string;
	onSelect: (optionIndex: number) => void;
	onCustomInput: (value: string) => void;
}) {
	const [localCustomInput, setLocalCustomInput] = useState(customInput || '');
	const [isCustomInputMode, setIsCustomInputMode] = useState(false);

	useEffect(() => {
		setLocalCustomInput(customInput || '');
	}, [customInput]);

	useInput((input, key) => {
		if (!isActive) return;

		if (isCustomInputMode) {
			// Handle text input
			if (key.return) {
				onCustomInput(localCustomInput);
				setIsCustomInputMode(false);
			} else if (key.escape) {
				setIsCustomInputMode(false);
				setLocalCustomInput(customInput || '');
			} else if (key.ctrl && input === 'c') {
				// Allow Ctrl+C to cancel
				return;
			} else if (key.backspace || key.delete) {
				setLocalCustomInput(prev => prev.slice(0, -1));
			} else if (input && !key.ctrl) {
				// Regular character input
				setLocalCustomInput(prev => prev + input);
			}
		} else {
			// Handle option selection navigation
			if (key.upArrow) {
				const maxIndex = question.multiSelect ? question.options.length : question.options.length - 1;
				const newSelectedIndex = selectedIndices[0] > 0 ? selectedIndices[0] - 1 : maxIndex;
				onSelect(newSelectedIndex);
			} else if (key.downArrow) {
				const maxIndex = question.multiSelect ? question.options.length : question.options.length - 1;
				const newSelectedIndex = selectedIndices[0] < maxIndex ? selectedIndices[0] + 1 : 0;
				onSelect(newSelectedIndex);
			} else if (key.return) {
				if (selectedIndices[0] === question.options.length) {
					// "Other" option selected
					setIsCustomInputMode(true);
				}
			} else if (input === ' ') {
				// Space to toggle multi-select
				if (question.multiSelect) {
					onSelect(selectedIndices[0]);
				}
			}
		}
	});

	return (
		<Box flexDirection="column" marginTop={1}>
			{/* Question header with chip */}
			<Box marginBottom={1}>
				<Text bold color="cyan">
					[{question.header}]
				</Text>
				<Text bold> {question.question}</Text>
			</Box>

			{/* Options */}
			<Box flexDirection="column" paddingLeft={2}>
				{question.options.map((option, optionIndex) => {
					const isSelected = selectedIndices.includes(optionIndex);
					const isFocused = selectedIndices[0] === optionIndex;

					return (
						<Box key={optionIndex}>
							<Text
								bold={isFocused && isActive}
								color={isActive && isFocused ? '#00ff00' : isSelected ? 'yellow' : 'white'}
							>
								{isFocused && isActive ? '▸ ' : '  '}
								{question.multiSelect ? (isSelected ? '☒' : '☐') : (isSelected ? '●' : '○')}
								{' '}
								{option.label}
							</Text>
							{(isSelected || isFocused) && (
								<Text dimColor>
									{' - '}
									{option.description}
								</Text>
							)}
						</Box>
					);
				})}

				{/* "Other" option for custom input */}
				<Box>
					<Text
						bold={selectedIndices[0] === question.options.length && isActive}
						color={
							isActive && selectedIndices[0] === question.options.length
								? '#00ff00'
								: 'white'
						}
					>
						{selectedIndices[0] === question.options.length && isActive ? '▸ ' : '  '}
						{question.multiSelect ? '☐' : '○'}
						{' Other (type custom response)'}
					</Text>
				</Box>
			</Box>

			{/* Custom input mode */}
			{isCustomInputMode && (
				<Box marginTop={1} paddingLeft={2}>
					<Text color="#00ff00">{'Your response: '}</Text>
					<Text bold color="#00ff00">{localCustomInput}</Text>
					<Text color="#666666">█</Text>
					<Text dimColor> (Enter to submit, Esc to cancel)</Text>
				</Box>
			)}

			{/* Multi-select hint */}
			{question.multiSelect && isActive && !isCustomInputMode && (
				<Box marginTop={1}>
					<Text dimColor>
						Use ↑/↓ to navigate, Space to toggle selection, Enter to continue
					</Text>
				</Box>
			)}

			{/* Single-select hint */}
			{!question.multiSelect && isActive && !isCustomInputMode && (
				<Box marginTop={1}>
					<Text dimColor>Use ↑/↓ to navigate, Enter to select</Text>
				</Box>
			)}
		</Box>
	);
}

export function InteractiveQuestionPrompt({
	questions,
	onSubmit,
	onCancel,
}: InteractiveQuestionPromptProps) {
	// Track current question index
	const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

	// Track selections for each question
	const [answers, setAnswers] = useState<Answer[]>(
		questions.map((q, i) => ({
			questionIndex: i,
			selectedOptions: q.multiSelect ? [] : [0], // Default to first option for single-select
		})),
	);

	const currentAnswer = answers[currentQuestionIndex];

	const handleSelectOption = useCallback(
		(optionIndex: number) => {
			const question = questions[currentQuestionIndex];
			setAnswers(prev =>
				prev.map((answer, idx) => {
					if (idx !== currentQuestionIndex) return answer;

					if (question.multiSelect) {
						// Toggle selection for multi-select
						const newSelected = answer.selectedOptions.includes(optionIndex)
							? answer.selectedOptions.filter(i => i !== optionIndex)
							: [...answer.selectedOptions, optionIndex];
						return {...answer, selectedOptions: newSelected};
					} else {
						// Replace selection for single-select
						return {...answer, selectedOptions: [optionIndex]};
					}
				}),
			);
		},
		[currentQuestionIndex, questions],
	);

	const handleCustomInput = useCallback(
		(value: string) => {
			setAnswers(prev =>
				prev.map((answer, idx) => {
					if (idx !== currentQuestionIndex) return answer;
					return {...answer, customInput: value, selectedOptions: [questions[currentQuestionIndex].options.length]}; // Select "Other" option
				}),
			);
		},
		[currentQuestionIndex, questions],
	);

	const handleNextQuestion = useCallback(() => {
		if (currentQuestionIndex < questions.length - 1) {
			setCurrentQuestionIndex(prev => prev + 1);
		} else {
			// All questions answered, submit
			const result: Record<string, string> = {};
			for (let i = 0; i < questions.length; i++) {
				const answer = answers[i];
				const question = questions[i];
				const key = `question_${i}`;

				if (answer.customInput) {
					result[key] = answer.customInput;
				} else if (question.multiSelect) {
					result[key] = answer.selectedOptions
						.map(idx => question.options[idx]?.label)
						.filter(Boolean)
						.join(', ');
				} else {
					const selectedIdx = answer.selectedOptions[0];
					result[key] = question.options[selectedIdx]?.label || '';
				}
			}
			onSubmit(result);
		}
	}, [currentQuestionIndex, questions, answers, onSubmit]);

	const handlePreviousQuestion = useCallback(() => {
		if (currentQuestionIndex > 0) {
			setCurrentQuestionIndex(prev => prev - 1);
		}
	}, [currentQuestionIndex]);

	useInput((input, key) => {
		// Handle global keyboard shortcuts
		if (key.escape) {
			onCancel();
		} else if (key.ctrl && input === 'c') {
			onCancel();
		} else if (key.return && !questions[currentQuestionIndex].multiSelect) {
			// For single-select questions, Enter confirms and moves to next
			const answer = answers[currentQuestionIndex];
			const question = questions[currentQuestionIndex];
			// Don't auto-advance if user is on "Other" option without input
			if (answer.selectedOptions[0] !== question.options.length || answer.customInput) {
				handleNextQuestion();
			}
		}
	});

	return (
		<Box flexDirection="column" marginTop={1} paddingX={1}>
			{/* Header */}
			<Box>
				<Text bold color="#00ff00">{'▶'}</Text>
				<Text color="#00ff00">{' Question'}</Text>
				{questions.length > 1 && (
					<Text color="#00ff00">{` (${currentQuestionIndex + 1}/${questions.length})`}</Text>
				)}
			</Box>

			{/* Progress bar for multiple questions */}
			{questions.length > 1 && (
				<Box marginTop={1} width={40}>
					{questions.map((_, idx) => (
						<Box key={idx}>
							<Text
								bold
								backgroundColor={idx === currentQuestionIndex ? '#00ff00' : idx < currentQuestionIndex ? '#666666' : 'black'}
								color={idx <= currentQuestionIndex ? 'black' : '#666666'}
							>
								{idx === currentQuestionIndex ? '►' : idx < currentQuestionIndex ? '✓' : '○'}
							</Text>
							{idx < questions.length - 1 && <Text color="#666666">{'─'}</Text>}
						</Box>
					))}
				</Box>
			)}

			{/* Current question */}
			<SingleQuestion
				question={questions[currentQuestionIndex]}
				questionIndex={currentQuestionIndex}
				isActive={true}
				selectedIndices={currentAnswer.selectedOptions}
				customInput={currentAnswer.customInput}
				onSelect={handleSelectOption}
				onCustomInput={handleCustomInput}
			/>

			{/* Navigation hint for multi-select */}
			{questions[currentQuestionIndex].multiSelect && (
				<Box marginTop={1}>
					<Text dimColor>
						Press Enter to{' '}
						{currentQuestionIndex < questions.length - 1 ? 'continue to next question' : 'submit answers'}
					</Text>
				</Box>
			)}

			{/* Cancel hint */}
			<Box marginTop={1}>
				<Text dimColor color="#888888">Esc to cancel</Text>
			</Box>
		</Box>
	);
}

export default InteractiveQuestionPrompt;
