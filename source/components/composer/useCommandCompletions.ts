import {type RefObject, useCallback, useEffect, useMemo, useRef} from 'react';
import {commandRegistry} from '@/commands';
import {useUIStateContext} from '@/hooks/useUIState';
import {getToolManager} from '@/message-handler';
import type {InputState} from '@/types/hooks';
import type {Completion} from '@/types/index';

interface UseCommandCompletionsOptions {
	/** The composer's text as of this render. */
	input: string;
	/** The composer's state, including placeholders. */
	currentState: InputState;
	/**
	 * The composer's latest state. Enter can arrive in the same stdin batch as
	 * the keys before it, ahead of a re-render, so the Enter gate reads this.
	 */
	latestStateRef: RefObject<InputState>;
	customCommands: string[];
	/** An `@` mention list is open; it takes over Tab and ↑/↓. */
	isMentionActive: boolean;
	/**
	 * True while the input was recalled from history rather than typed. A
	 * recalled `/command` must not open the menu, or the menu would capture
	 * ↑/↓ and block further history navigation.
	 */
	inputFromHistoryRef: RefObject<boolean>;
	setInputState: (state: InputState) => void;
	/** Remount TextInput after a completion replaces the input. Stable. */
	onInputReplaced: () => void;
}

/**
 * Slash-command completion: the menu of built-in, custom and MCP-prompt
 * commands matching the typed `/prefix`, when it opens and closes, and the
 * Tab / Enter / ↑↓ keys that drive it. The menu's state lives in the shared
 * UI state context so the rest of the app can reset it.
 */
export function useCommandCompletions({
	input,
	currentState,
	latestStateRef,
	customCommands,
	isMentionActive,
	inputFromHistoryRef,
	setInputState,
	onInputReplaced,
}: UseCommandCompletionsOptions) {
	const {
		showCompletions,
		completions,
		selectedCompletionIndex,
		setShowCompletions,
		setCompletions,
		setSelectedCompletionIndex,
	} = useUIStateContext();

	// Set when a completion (or the suggested command) replaces the input, so
	// the auto-show effect skips the run that change schedules.
	const completionJustSelectedRef = useRef(false);
	// Input value for which the menu was closed, by Escape or by selecting a
	// completion, so it doesn't re-open until the user types more.
	const dismissedForInputRef = useRef<string | null>(null);

	// Command completions for a given input value. Shared by the memo below
	// and the Enter gate, which can run ahead of a re-render (see there).
	const getCommandCompletions = useCallback(
		(value: string): Completion[] => {
			if (!value.trim().startsWith('/') || isMentionActive) {
				return [];
			}

			// Once the user types a space, they're entering arguments for the
			// command (e.g. `/model gpt-4`). Stop offering completions so Enter
			// submits the command-with-args instead of selecting a completion and
			// dropping everything after the command name.
			if (value.slice(1).includes(' ')) {
				return [];
			}

			const commandPrefix = value.slice(1).split(' ')[0];

			const builtInCompletions = commandRegistry.getCompletions(commandPrefix);
			const mcpPromptNames = (
				getToolManager()?.getMCPClient()?.getAllPrompts() ?? []
			).map(p => `mcp:${p.serverName}:${p.name}`);
			const customCompletions = [...customCommands, ...mcpPromptNames]
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
		},
		[isMentionActive, customCommands],
	);

	// Calculate command completions using useMemo to prevent flashing
	const commandCompletions = useMemo(
		() => getCommandCompletions(input),
		[getCommandCompletions, input],
	);

	// The menu opens whenever completions exist, unless it was closed for this
	// exact input or the input was recalled from history (keep ↑/↓ free to
	// navigate).
	const isMenuSuppressedFor = useCallback(
		(value: string) =>
			inputFromHistoryRef.current || dismissedForInputRef.current === value,
		[inputFromHistoryRef],
	);

	useEffect(() => {
		// This run can still carry the pre-selection input: selecting sets
		// `input` and closes the menu together, and the run that the close
		// schedules gets here first. `dismissedForInputRef` is set at the
		// selection itself for that reason - reading `input` here would record
		// the fragment and let the menu re-open on the completed command.
		if (completionJustSelectedRef.current) {
			completionJustSelectedRef.current = false;
			return;
		}
		if (commandCompletions.length > 0) {
			setCompletions(commandCompletions);
			// Show the menu as soon as completions exist (typing `/`), not only on Tab.
			if (!isMenuSuppressedFor(input)) {
				setShowCompletions(true);
			}
			setSelectedCompletionIndex(prev =>
				prev >= commandCompletions.length
					? commandCompletions.length - 1
					: prev < 0
						? 0
						: prev,
			);
		} else if (showCompletions) {
			setCompletions([]);
			setShowCompletions(false);
			setSelectedCompletionIndex(-1);
		}
	}, [
		input,
		commandCompletions,
		showCompletions,
		setCompletions,
		setShowCompletions,
		setSelectedCompletionIndex,
		isMenuSuppressedFor,
	]);

	/** Replace the input with `/name` and close the menu for it. */
	const completeTo = (name: string) => {
		const completedText = `/${name}`;
		completionJustSelectedRef.current = true;
		dismissedForInputRef.current = completedText;
		setInputState({displayValue: completedText, placeholderContent: {}});
		setShowCompletions(false);
		setSelectedCompletionIndex(-1);
		onInputReplaced();
	};

	/** Escape: close the menu until the input changes. */
	const dismiss = useCallback(() => {
		setShowCompletions(false);
		setSelectedCompletionIndex(-1);
		dismissedForInputRef.current = input;
	}, [input, setShowCompletions, setSelectedCompletionIndex]);

	/** Hide the menu without remembering the input (entering Ctrl+R search). */
	const hide = () => setShowCompletions(false);

	/**
	 * The input is about to be replaced by something other than typing (the
	 * suggested command); don't pop the menu over it.
	 */
	const suppressNextAutoShow = () => {
		completionJustSelectedRef.current = true;
	};

	/**
	 * Tab on a `/command`: select the highlighted entry when the menu is open,
	 * complete a single match, or open the menu on several. Returns false when
	 * the input is not a command.
	 */
	const handleTab = (): boolean => {
		if (!input.startsWith('/')) return false;

		// Tab selects the highlighted suggestion when the menu is open. #696 made
		// completion Tab-triggered, but that often failed to render the menu
		// (especially in alt-screen); show-on-`/` + Tab-to-select is more reliable.
		if (showCompletions && completions.length > 0) {
			const selected =
				completions[selectedCompletionIndex >= 0 ? selectedCompletionIndex : 0];
			completeTo(selected.name);
			return true;
		}
		if (commandCompletions.length === 1) {
			// Auto-complete when there's exactly one match. setInputState bypasses
			// paste detection for autocomplete.
			setInputState({
				displayValue: `/${commandCompletions[0].name}`,
				placeholderContent: currentState.placeholderContent,
			});
			onInputReplaced();
		} else if (commandCompletions.length > 1) {
			setCompletions(commandCompletions);
			setShowCompletions(true);
			setSelectedCompletionIndex(0);
		}
		return true;
	};

	/**
	 * Enter while a command is being typed: complete it instead of submitting
	 * the fragment. Returns true when it completed, false when Enter should
	 * submit (no menu, or the command is already typed in full).
	 *
	 * The effect above opens the menu a commit after the keystroke that changed
	 * `input`, so an Enter landing in between still sees it closed; fall back to
	 * the completions the effect is about to show. Decide on the latest input,
	 * not the render-time one, since submit uses the latest input too.
	 */
	const completeOnEnter = (): boolean => {
		const latestInput = latestStateRef.current.displayValue;
		const isStale = latestInput !== input;
		const menuItems =
			!isStale &&
			showCompletions &&
			completions.length > 0 &&
			selectedCompletionIndex >= 0
				? completions
				: isMenuSuppressedFor(latestInput)
					? []
					: isStale
						? getCommandCompletions(latestInput)
						: commandCompletions;
		if (menuItems.length === 0) return false;

		const selected =
			menuItems[
				Math.min(Math.max(selectedCompletionIndex, 0), menuItems.length - 1)
			];
		// Already typed in full, so there is nothing to complete: fall through
		// and submit instead of needing a second Enter.
		if (`/${selected.name}` === latestInput) return false;
		completeTo(selected.name);
		return true;
	};

	/** ↑/↓ through the open menu, wrapping. False when the menu is closed. */
	const moveSelection = (direction: 'up' | 'down'): boolean => {
		if (!showCompletions || completions.length === 0) return false;
		setSelectedCompletionIndex(prev =>
			direction === 'up'
				? prev > 0
					? prev - 1
					: completions.length - 1
				: prev < completions.length - 1
					? prev + 1
					: 0,
		);
		return true;
	};

	return {
		isOpen: showCompletions,
		items: completions,
		selectedIndex: selectedCompletionIndex,
		dismiss,
		hide,
		suppressNextAutoShow,
		handleTab,
		completeOnEnter,
		moveSelection,
	};
}
