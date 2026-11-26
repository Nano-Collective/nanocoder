import type {Key} from 'ink';
import type {InteractiveAppHandle} from '@/app/sections/interactive-app';

interface ExitKeyState {
	/** Shutdown already started: another Ctrl+C force-quits. */
	exiting: boolean;
	/** SubagentView is open and handles Ctrl+C itself. */
	subagentAttached: boolean;
	/** The chat UI, or null on screens before or outside it. */
	chat: InteractiveAppHandle | null;
}

/**
 * Whether App should exit for this key. The chat UI gets Ctrl+C first
 * (cancel, clear, or the exit hint); Ctrl+D exits from an empty prompt.
 * Screens without the chat UI exit on the first Ctrl+C.
 */
export function isExitKeyPress(
	input: string,
	key: Key,
	{exiting, subagentAttached, chat}: ExitKeyState,
): boolean {
	if (!key.ctrl) return false;
	if (input === 'c') {
		if (exiting) return true;
		if (subagentAttached) return false;
		return !chat?.handleCtrlC();
	}
	if (input === 'd') return chat?.promptIsEmpty() ?? false;
	return false;
}
