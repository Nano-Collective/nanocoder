import {Box, Text, useFocus, useInput} from 'ink';
import Spinner from 'ink-spinner';
import TextInput from 'ink-text-input';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {commandRegistry} from '@/commands';
import {DevelopmentModeIndicator} from '@/components/development-mode-indicator';
import {useInputState} from '@/hooks/useInputState';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {useUIStateContext} from '@/hooks/useUIState';
import {promptHistory} from '@/prompt-history';
import type {DevelopmentMode} from '@/types/core';
import {Completion} from '@/types/index';
import {
	getCurrentFileMention,
	getFileCompletions,
} from '@/utils/file-autocomplete';
import {handleFileMention} from '@/utils/file-mention-handler';
import {assemblePrompt} from '@/utils/prompt-processor';

interface ChatProps {
	onSubmit?: (message: string) => void;
	placeholder?: string;
	customCommands?: string[]; // List of custom command names and aliases
	disabled?: boolean; // Disable input when AI is processing
	onCancel?: () => void; // Callback when user presses escape while thinking
	onToggleMode?: () => void; // Callback when user presses shift+tab to toggle development mode
	developmentMode?: DevelopmentMode; // Current development mode
	contextPercentUsed?: number | null; // Context window usage percentage
}

export default function UserInput({
	onSubmit,
	placeholder,
	customCommands = [],
	disabled = false,
	onCancel,
	onToggleMode,
	developmentMode = 'normal',
	contextPercentUsed,
}: ChatProps) {
	const {isFocused, focus} = useFocus({autoFocus: !disabled, id: 'user-input'});
	const {colors} = useTheme();
	const inputState = useInputState();
	const uiState = useUIStateContext();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const [textInputKey, setTextInputKey] = useState(0);
	// Store the original InputState (including placeholders) when starting history navigation
	// File autocomplete state
	const [isFileAutocompleteMode, setIsFileAutocompleteMode] = useState(false);
	const [fileCompletions, setFileCompletions] = useState<
		Array<{path: string; score: number}>
	>([]);
	const [selectedFileIndex, setSelectedFileIndex] = useState(0);

	// Responsive placeholder text
	const defaultPlaceholder = isNarrow
		? '/ for commands, ! for bash, ↑/↓ history'
		: 'Type `/` and then press Tab for command suggestions or `!` to execute bash commands. Use ↑/↓ for history.';
	const actualPlaceholder = placeholder ?? defaultPlaceholder;

	const {
		input,
		historyIndex,
		setOriginalInput,
		setHistoryIndex,
		updateInput,
		resetInput,
		deletePlaceholder: _deletePlaceholder,
		currentState,
		setInputState,
	} = inputState;

	const {
		showClearMessage,
		showCompletions,
		completions,
		pendingFileMentions,
		setShowClearMessage,
		setShowCompletions,
		setCompletions,
		setPendingFileMentions,
		resetUIState,
	} = uiState;

	// Check if we're in bash mode (input starts with !)
	const isBashMode = input.trim().startsWith('!');

	// Check if we're in command mode (input starts with /)
	const isCommandMode = input.trim().startsWith('/');

	// Load history on mount
	useEffect(() => {
		void promptHistory.loadHistory();
	}, []);

	// Consume pending file mentions from explorer and insert into input
	// Properly attach files by calling handleFileMention for each
	useEffect(() => {
		if (pendingFileMentions.length === 0) return;

		const attachFiles = async () => {
			let state = currentState;
			let displayValue = state.displayValue;

			for (const filePath of pendingFileMentions) {
				// Create a temporary mention text to replace
				const mentionText = `@${filePath}`;
				// Add the mention to display value first
				displayValue = displayValue
					? `${displayValue} ${mentionText}`
					: mentionText;

				// Handle the file mention to create placeholder
				const result = await handleFileMention(
					filePath,
					displayValue,
					state.placeholderContent,
					mentionText,
				);

				if (result) {
					state = result;
					displayValue = result.displayValue;
				}
			}

			setInputState(state);
			setTextInputKey(prev => prev + 1);
			setPendingFileMentions([]);
		};

		void attachFiles();
	}, [
		pendingFileMentions,
		currentState,
		setInputState,
		setPendingFileMentions,
	]);

	// Trigger file autocomplete when input changes
	useEffect(() => {
		const runFileAutocomplete = async () => {
			const mention = getCurrentFileMention(input, input.length);

			if (mention) {
				setIsFileAutocompleteMode(true);
				const cwd = process.cwd();
				const completions = await getFileCompletions(mention.mention, cwd);
				setFileCompletions(completions);
				setSelectedFileIndex(0); // Reset selection when completions change
			} else {
				setIsFileAutocompleteMode(false);
				setFileCompletions([]);
				setSelectedFileIndex(0);
			}
		};

		void runFileAutocomplete();
	}, [input]);

	// Calculate command completions using useMemo to prevent flashing
	const commandCompletions = useMemo(() => {
		if (!isCommandMode || isFileAutocompleteMode) {
			return [];
		}

		const commandPrefix = input.slice(1).split(' ')[0];

		const builtInCompletions = commandRegistry.getCompletions(commandPrefix);
		const customCompletions = customCommands
			.filter(cmd => {
				// Include all when no prefix, otherwise filter by prefix
				return (
					!commandPrefix ||
					cmd.toLowerCase().includes(commandPrefix.toLowerCase())
				);
			})
			.sort((a, b) => a.localeCompare(b));

		return [
			...builtInCompletions.map(cmd => ({name: cmd, isCustom: false})),
			...customCompletions.map(cmd => ({name: cmd, isCustom: true})),
		] as Completion[];
	}, [input, isCommandMode, isFileAutocompleteMode, customCommands]);

	// Update UI state for command completions
	useEffect(() => {
		if (commandCompletions.length > 0) {
			setCompletions(commandCompletions);
			setShowCompletions(true);
		} else if (showCompletions) {
			setCompletions([]);
			setShowCompletions(false);
		}
	}, [commandCompletions, showCompletions, setCompletions, setShowCompletions]);

	// Helper functions

	// Handle file mention selection (Tab key in file autocomplete mode)
	const handleFileSelection = useCallback(async () => {
		if (!isFileAutocompleteMode || fileCompletions.length === 0) {
			return false;
		}

		const mention = getCurrentFileMention(input, input.length);
		if (!mention) {
			return false;
		}

		// Select the currently highlighted file
		const selectedPath = fileCompletions[selectedFileIndex]?.path;
		if (!selectedPath) {
			return false;
		}

		// Extract the original mention text (the @... part we're replacing)
		const mentionText = input.substring(mention.startIndex, mention.endIndex);

		// Handle the file mention to create placeholder
		const result = await handleFileMention(
			selectedPath,
			currentState.displayValue,
			currentState.placeholderContent,
			mentionText,
		);

		if (result) {
			setInputState(result);
			setIsFileAutocompleteMode(false);
			setFileCompletions([]);
			setSelectedFileIndex(0);
			setTextInputKey(prev => prev + 1);
			return true;
		}

		return false;
	}, [
		isFileAutocompleteMode,
		fileCompletions,
		selectedFileIndex,
		input,
		currentState,
		setInputState,
	]);

	// Handle form submission
	const handleSubmit = useCallback(() => {
		if (input.trim() && onSubmit) {
			// Assemble the full prompt by replacing placeholders with content
			const fullMessage = assemblePrompt(currentState);

			// Save the InputState to history and send assembled message to AI
			promptHistory.addPrompt(currentState);
			onSubmit(fullMessage);
			resetInput();
			resetUIState();
			promptHistory.resetIndex();
		}
	}, [input, onSubmit, resetInput, resetUIState, currentState]);

	// Handle escape key logic
	const handleEscape = useCallback(() => {
		if (showClearMessage) {
			resetInput();
			resetUIState();
			focus('user-input');
		} else {
			setShowClearMessage(true);
		}
	}, [showClearMessage, resetInput, resetUIState, setShowClearMessage, focus]);

	// History navigation
	const handleHistoryNavigation = useCallback(
		(direction: 'up' | 'down') => {
			const history = promptHistory.getHistory();
			if (history.length === 0) return;

			if (direction === 'up') {
				if (historyIndex === -1) {
					// Save the full current state (including placeholders) before starting navigation
					setOriginalInput(input);
					setHistoryIndex(history.length - 1);
					setInputState(history[history.length - 1]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex > 0) {
					const newIndex = historyIndex - 1;
					setHistoryIndex(newIndex);
					setInputState(history[newIndex]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === 0) {
					// At first history item, go to blank
					setHistoryIndex(-2);
					setOriginalInput('');
					updateInput('');
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === -2) {
					// At blank, cycle back to last history item
					setHistoryIndex(history.length - 1);
					setInputState(history[history.length - 1]);
					setTextInputKey(prev => prev + 1);
				}
			} else {
				if (historyIndex === -1) {
					// At original input, go to blank when cycling down
					setOriginalInput(input);
					setHistoryIndex(-2);
					setOriginalInput('');
					updateInput('');
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === -2) {
					// At blank, cycle to first history item
					setHistoryIndex(0);
					setInputState(history[0]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex >= 0 && historyIndex < history.length - 1) {
					// Move forward in history
					const newIndex = historyIndex + 1;
					setHistoryIndex(newIndex);
					setInputState(history[newIndex]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === history.length - 1) {
					// At last history item, cycle back to blank
					setHistoryIndex(-2);
					setOriginalInput('');
					updateInput('');
					setTextInputKey(prev => prev + 1);
				}
			}
		},
		[
			historyIndex,
			input,
			setHistoryIndex,
			setOriginalInput,
			setInputState,
			updateInput,
		],
	);

	useInput((inputChar, key) => {
		// Handle escape for cancellation even when disabled
		if (key.escape && disabled && onCancel) {
			onCancel();
			return;
		}

		// Handle shift+tab to toggle development mode (always available)
		if (key.tab && key.shift && onToggleMode) {
			onToggleMode();
			return;
		}

		// Block all other input when disabled
		if (disabled) {
			return;
		}

		// Handle special keys
		if (key.escape) {
			handleEscape();
			return;
		}

		// Handle Tab key
		if (key.tab) {
			// File autocomplete takes priority
			if (isFileAutocompleteMode) {
				void handleFileSelection();
				return;
			}

			// Command completion - use pre-calculated commandCompletions
			if (input.startsWith('/')) {
				if (commandCompletions.length === 1) {
					// Auto-complete when there's exactly one match
					const completion = commandCompletions[0];
					const completedText = `/${completion.name}`;
					// Use setInputState to bypass paste detection for autocomplete
					setInputState({
						displayValue: completedText,
						placeholderContent: currentState.placeholderContent,
					});
					setTextInputKey(prev => prev + 1);
				} else if (commandCompletions.length > 1) {
					// If completions are already showing, autocomplete to the first result
					if (showCompletions && completions.length > 0) {
						const completion = completions[0];
						const completedText = `/${completion.name}`;
						// Use setInputState to bypass paste detection for autocomplete
						setInputState({
							displayValue: completedText,
							placeholderContent: currentState.placeholderContent,
						});
						setShowCompletions(false);
						setTextInputKey(prev => prev + 1);
					} else {
						// Show completions when there are multiple matches
						setCompletions(commandCompletions);
						setShowCompletions(true);
					}
				}
				return;
			}
		}

		// Space exits file autocomplete mode
		if (inputChar === ' ' && isFileAutocompleteMode) {
			setIsFileAutocompleteMode(false);
			setFileCompletions([]);
		}

		// Clear clear message on other input
		if (showClearMessage) {
			setShowClearMessage(false);
			focus('user-input');
		}

		// Handle return keys for multiline input
		// Support Shift+Enter if the terminal sends it properly
		if (key.return && key.shift) {
			updateInput(input + '\n');
			return;
		}

		// VSCode terminal sends Option+Enter as '\r' with key.return === false
		// Regular Enter in VSCode sends '\r' with key.return === true
		// So we use key.return to distinguish: false = multiline, true = submit
		if (inputChar === '\r' && !key.return) {
			updateInput(input + '\n');
			return;
		}

		// Handle navigation
		if (key.upArrow) {
			// File autocomplete navigation takes priority
			if (isFileAutocompleteMode && fileCompletions.length > 0) {
				setSelectedFileIndex(prev =>
					prev > 0 ? prev - 1 : fileCompletions.length - 1,
				);
				return;
			}
			handleHistoryNavigation('up');
			return;
		}

		if (key.downArrow) {
			// File autocomplete navigation takes priority
			if (isFileAutocompleteMode && fileCompletions.length > 0) {
				setSelectedFileIndex(prev =>
					prev < fileCompletions.length - 1 ? prev + 1 : 0,
				);
				return;
			}
			handleHistoryNavigation('down');
			return;
		}
	});

	const textColor = disabled || !input ? colors.secondary : colors.primary;

	// When disabled, show minimal UI to avoid cluttering the screen
	if (disabled) {
		return (
			<Box flexDirection="column" paddingY={1} width="100%" marginTop={1}>
				<Text color={colors.secondary} dimColor>
					<Spinner type="dots" /> Press Esc to cancel
				</Text>
				<DevelopmentModeIndicator
					developmentMode={developmentMode}
					colors={colors}
					contextPercentUsed={contextPercentUsed ?? null}
				/>
			</Box>
		);
	}

	return (
		<>
			{!isBashMode ? (
				<Text color={colors.primary} bold>
					What would you like me to help with?
				</Text>
			) : (
				<Text color={colors.tool} bold>
					Bash mode
				</Text>
			)}
			<Box
				flexDirection="column"
				marginTop={1}
				backgroundColor={colors.base}
				width={boxWidth}
				padding={1}
				borderStyle="bold"
				borderLeft={true}
				borderRight={false}
				borderTop={false}
				borderBottom={false}
				borderLeftColor={isBashMode ? colors.tool : colors.primary}
			>
				{/* Input row */}
				<Box>
					{input.length === 0 && (
						<Text color={isBashMode ? colors.tool : textColor}>{'>'} </Text>
					)}
					<TextInput
						key={textInputKey}
						value={input}
						onChange={updateInput}
						onSubmit={handleSubmit}
						placeholder={actualPlaceholder}
						focus={isFocused}
					/>
				</Box>

				{showClearMessage && (
					<Text color={colors.secondary} dimColor>
						Press escape again to clear
					</Text>
				)}
			</Box>

			{showCompletions && completions.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.secondary}>Available commands:</Text>
					{completions.map((completion, index) => (
						<Text
							key={index}
							color={completion.isCustom ? colors.info : colors.primary}
						>
							/{completion.name}
						</Text>
					))}
				</Box>
			)}
			{isFileAutocompleteMode && fileCompletions.length > 0 && (
				<Box flexDirection="column" marginTop={1}>
					<Text color={colors.secondary}>
						File suggestions (↑/↓ to navigate, Tab to select):
					</Text>
					{fileCompletions.slice(0, 5).map((file, index) => (
						<Text
							key={index}
							color={index === selectedFileIndex ? colors.info : colors.primary}
							bold={index === selectedFileIndex}
						>
							{index === selectedFileIndex ? '▸ ' : '  '}
							{file.path}
						</Text>
					))}
				</Box>
			)}

			{/* Development mode indicator - always visible */}
			<DevelopmentModeIndicator
				developmentMode={developmentMode}
				colors={colors}
				contextPercentUsed={contextPercentUsed ?? null}
			/>
		</>
	);
}
