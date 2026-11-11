import type {Key} from 'ink';
import {useRef, useState} from 'react';
import {isComposerKey} from '@/components/composer/keymap';
import {promptHistory} from '@/prompt-history';
import type {InputState} from '@/types/hooks';

/**
 * Newest history entry at or before `startIndex` whose text contains `query`
 * (case-insensitive). Malformed entries are skipped rather than thrown on.
 */
export function findReverseMatch(
	history: InputState[],
	query: string,
	startIndex: number,
): {index: number; match: InputState} | null {
	if (history.length === 0) return null;
	const queryLower = query.toLowerCase();
	const start = Math.min(startIndex, history.length - 1);
	for (let i = start; i >= 0; i--) {
		const displayValue = history[i]?.displayValue;
		if (
			typeof displayValue === 'string' &&
			displayValue.toLowerCase().includes(queryLower)
		) {
			return {index: i, match: history[i]};
		}
	}
	return null;
}

/**
 * How a key ended the search. `restore` is what the composer should show
 * next: the matched prompt on Enter (null when nothing matched, leaving the
 * composer as it was), or the draft from before the search on Escape.
 */
export interface ReverseSearchExit {
	restore: InputState | null;
}

/**
 * Ctrl+R reverse prompt search (bck-i-search): the query, the current match,
 * and the keys that drive it while it owns the keyboard.
 */
export function useReverseSearch() {
	const [isActive, setIsActive] = useState(false);
	const [query, setQuery] = useState('');
	const [matchIndex, setMatchIndex] = useState(-1);
	const [match, setMatch] = useState<InputState | null>(null);
	const draftRef = useRef<InputState>({
		displayValue: '',
		placeholderContent: {},
	});

	const showMatch = (result: ReturnType<typeof findReverseMatch>) => {
		if (result) {
			setMatchIndex(result.index);
			setMatch(result.match);
		} else {
			setMatchIndex(-1);
			setMatch(null);
		}
	};

	/** Searches the whole history, newest first, for `nextQuery`. */
	const searchFor = (nextQuery: string) => {
		const history = promptHistory.getHistory();
		setQuery(nextQuery);
		showMatch(findReverseMatch(history, nextQuery, history.length - 1));
	};

	const exit = () => {
		setIsActive(false);
		setQuery('');
		setMatchIndex(-1);
		setMatch(null);
	};

	/** Enter search mode, remembering `draft` so Escape can put it back. */
	const start = (draft: InputState) => {
		const history = promptHistory.getHistory();
		draftRef.current = draft;
		setIsActive(true);
		setQuery('');
		showMatch(findReverseMatch(history, '', history.length - 1));
	};

	/**
	 * Handle a key while the search is active. Returns how the search ended,
	 * or null when it is still running. Every key is consumed.
	 */
	const handleKey = (input: string, key: Key): ReverseSearchExit | null => {
		// Ctrl+C is deliberately not handled here: App.tsx's global handler
		// exits the app on it, so it can't double as "cancel search".
		if (key.escape) {
			exit();
			return {restore: draftRef.current};
		}

		if (key.return) {
			exit();
			return {restore: match};
		}

		if (isComposerKey('reverseSearch', input, key)) {
			// Cycle to the next older match for the same query (stop at oldest).
			const history = promptHistory.getHistory();
			if (history.length > 0 && matchIndex > 0) {
				const older = findReverseMatch(history, query, matchIndex - 1);
				if (older) {
					setMatchIndex(older.index);
					setMatch(older.match);
				}
			}
			return null;
		}

		if (key.backspace || key.delete) {
			searchFor(query.slice(0, -1));
			return null;
		}

		// Ignore other control/meta combinations while in search mode.
		if (key.ctrl || key.meta) {
			return null;
		}

		if (
			input &&
			!key.upArrow &&
			!key.downArrow &&
			!key.leftArrow &&
			!key.rightArrow &&
			!key.tab
		) {
			searchFor(query + input);
		}
		return null;
	};

	return {isActive, query, match, start, handleKey};
}
