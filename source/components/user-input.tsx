import {Box, Text, useFocus, useInput} from 'ink';
import TextInput from 'ink-text-input';
import {useCallback, useEffect, useMemo, useState} from 'react';
import {useTheme} from '@/hooks/useTheme';
import {promptHistory} from '@/prompt-history';
import {commandRegistry} from '@/commands';
import {useResponsiveTerminal} from '@/hooks/useTerminalWidth';
import {useUIStateContext} from '@/hooks/useUIState';
import {useInputState} from '@/hooks/useInputState';
import {assemblePrompt} from '@/utils/prompt-processor';
import {Completion} from '@/types/index';
import {DevelopmentMode, DEVELOPMENT_MODE_LABELS} from '@/types/core';
import {
	getCurrentFileMention,
	getFileCompletions,
} from '@/utils/file-autocomplete';
import {handleFileMention} from '@/utils/file-mention-handler';
import Spinner from 'ink-spinner';

interface ChatProps {
	onSubmit?: (message: string) => void;
	placeholder?: string;
	customCommands?: string[]; // List of custom command names and aliases
	disabled?: boolean; // Disable input when AI is processing
	onCancel?: () => void; // Callback when user presses escape while thinking
	onToggleMode?: () => void; // Callback when user presses shift+tab to toggle development mode
	developmentMode?: DevelopmentMode; // Current development mode
}

export default function UserInput({
	onSubmit,
	placeholder,
	customCommands = [],
	disabled = false,
	onCancel,
	onToggleMode,
	developmentMode = 'normal',
}: ChatProps) {
	const {isFocused, focus} = useFocus({autoFocus: !disabled, id: 'user-input'});
	const {colors} = useTheme();
	const inputState = useInputState();
	const uiState = useUIStateContext();
	const {boxWidth, isNarrow} = useResponsiveTerminal();
	const [textInputKey, setTextInputKey] = useState(0);
	// Store the original InputState (including placeholders) when starting history navigation
	const [originalInputState, setOriginalInputState] = useState<
		typeof inputState.currentState | null
	>(null);

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
		originalInput,
		historyIndex,
		setOriginalInput,
		setHistoryIndex,
		updateInput,
		resetInput,
		// New paste handling functions
		undo,
		redo,
		deletePlaceholder: _deletePlaceholder,
		currentState,
		setInputState,
	} = inputState;

	const {
		showClearMessage,
		showCompletions,
		completions,
		setShowClearMessage,
		setShowCompletions,
		setCompletions,
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
		if (commandPrefix.length === 0) {
			return [];
		}

		const builtInCompletions = commandRegistry.getCompletions(commandPrefix);
		const customCompletions = customCommands
			.filter(cmd => {
				return cmd.toLowerCase().includes(commandPrefix.toLowerCase());
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
					setOriginalInputState(currentState);
					setOriginalInput(input);
					setHistoryIndex(history.length - 1);
					setInputState(history[history.length - 1]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex > 0) {
					const newIndex = historyIndex - 1;
					setHistoryIndex(newIndex);
					setInputState(history[newIndex]);
					setTextInputKey(prev => prev + 1);
				} else {
					// Clear when going past the first history item
					setHistoryIndex(-2);
					setOriginalInput('');
					updateInput('');
					setTextInputKey(prev => prev + 1);
				}
			} else {
				if (historyIndex >= 0 && historyIndex < history.length - 1) {
					const newIndex = historyIndex + 1;
					setHistoryIndex(newIndex);
					setInputState(history[newIndex]);
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === history.length - 1) {
					// Restore the full original state (including placeholders)
					setHistoryIndex(-1);
					if (originalInputState) {
						setInputState(originalInputState);
						setOriginalInputState(null);
					} else {
						updateInput(originalInput);
					}
					setOriginalInput('');
					setTextInputKey(prev => prev + 1);
				} else if (historyIndex === -2) {
					// Restore the original input state when pressing down from the empty state
					setHistoryIndex(-1);
					if (originalInputState) {
						setInputState(originalInputState);
						setOriginalInputState(null);
					} else {
						updateInput(originalInput);
					}
					setOriginalInput('');
					setTextInputKey(prev => prev + 1);
				}
			}
		},
		[
			historyIndex,
			input,
			originalInput,
			currentState,
			originalInputState,
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

		// Ctrl+B removed - no longer needed with new paste system

		// Undo: Ctrl+_ (Ctrl+Shift+-)
		if (key.ctrl && inputChar === '_') {
			undo();
			return;
		}

		// Redo: Ctrl+Y
		if (key.ctrl && inputChar === 'y') {
			redo();
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

	return (
		<Box flexDirection="column" paddingY={1} width="100%" marginTop={1}>
			<Box
				flexDirection="column"
				borderStyle={isBashMode ? 'round' : undefined}
				borderColor={isBashMode ? colors.tool : undefined}
				paddingX={isBashMode ? 1 : 0}
				width={isBashMode ? boxWidth : undefined}
			>
				{!isBashMode && (
					<>
						<Text color={colors.primary} bold>
							{disabled ? '' : 'What would you like me to help with?'}
						</Text>
					</>
				)}

				{/* Input row */}
				<Box>
					<Text color={textColor}>{'>'} </Text>
					{disabled ? (
						<Text color={colors.secondary}>
							<Spinner type="dots" />
						</Text>
					) : (
						<TextInput
							key={textInputKey}
							value={input}
							onChange={updateInput}
							onSubmit={handleSubmit}
							placeholder={actualPlaceholder}
							focus={isFocused}
						/>
					)}
				</Box>

				{isBashMode && (
					<Text color={colors.tool} dimColor>
						Bash Mode
					</Text>
				)}
				{showClearMessage && (
					<Text color={colors.secondary} dimColor>
						Press escape again to clear
					</Text>
				)}
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
								color={
									index === selectedFileIndex ? colors.info : colors.primary
								}
								bold={index === selectedFileIndex}
							>
								{index === selectedFileIndex ? '▸ ' : '  '}
								{file.path}
							</Text>
						))}
					</Box>
				)}
			</Box>

			{/* Development mode indicator - always visible */}
			<Box marginTop={1}>
				<Text
					color={
						developmentMode === 'normal'
							? colors.secondary
							: developmentMode === 'auto-accept'
							? colors.info
							: colors.warning
					}
				>
					<Text bold>{DEVELOPMENT_MODE_LABELS[developmentMode]}</Text>{' '}
					<Text dimColor>(Shift+Tab to cycle)</Text>
				</Text>
			</Box>
		</Box>
	);
}
