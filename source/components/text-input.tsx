import chalk from 'chalk';
import {Text, useInput} from 'ink';
import {useEffect, useRef, useState} from 'react';
import {
	getVisualLineSegments,
	moveCursorToVisualLine,
	wrapWithTrimmedContinuations,
} from '@/utils/text-wrapping';

export type Props = {
	readonly placeholder?: string;
	readonly focus?: boolean;
	readonly mask?: string;
	readonly showCursor?: boolean;
	readonly highlightPastedText?: boolean;
	readonly value: string;
	readonly onChange: (value: string) => void;
	readonly onSubmit?: (value: string) => void;
	readonly onEnter?: (value: string) => void;
	readonly wrapWidth?: number;
	readonly handleEnter?: boolean;
	readonly onEdgeArrow?: (direction: 'up' | 'down') => void;
};

function TextInput({
	value: originalValue,
	placeholder = '',
	focus = true,
	mask,
	highlightPastedText = false,
	showCursor = true,
	onChange,
	onSubmit,
	onEnter,
	wrapWidth,
	handleEnter = true,
	onEdgeArrow,
}: Props) {
	const [state, setState] = useState({
		cursorOffset: (originalValue || '').length,
		cursorWidth: 0,
	});

	const {cursorOffset, cursorWidth} = state;

	// Refs so useInput handlers always read the latest values (avoids stale closures)
	const cursorOffsetRef = useRef(cursorOffset);
	const originalValueRef = useRef(originalValue);
	cursorOffsetRef.current = cursorOffset;
	originalValueRef.current = originalValue;

	useEffect(() => {
		setState(previousState => {
			if (!focus || !showCursor) {
				return previousState;
			}

			const newValue = originalValue || '';

			if (previousState.cursorOffset > newValue.length - 1) {
				return {
					cursorOffset: newValue.length,
					cursorWidth: 0,
				};
			}

			return previousState;
		});
	}, [originalValue, focus, showCursor]);

	// Word-jump helpers (whitespace-delimited, like readline Alt+B/F)
	// Newlines are treated as whitespace — Ctrl+Left/Right cross line boundaries.
	function moveToPrevWord(value: string, offset: number): number {
		let i = offset;
		// Skip whitespace (spaces + newlines) backward, then word backward
		while (i > 0 && (value[i - 1] === ' ' || value[i - 1] === '\n')) i--;
		while (i > 0 && value[i - 1] !== ' ' && value[i - 1] !== '\n') i--;
		return i;
	}

	function moveToNextWord(value: string, offset: number): number {
		let i = offset;
		// Skip word forward, then whitespace (spaces + newlines) forward
		while (i < value.length && value[i] !== ' ' && value[i] !== '\n') i++;
		while (i < value.length && (value[i] === ' ' || value[i] === '\n')) i++;
		return i;
	}

	const cursorActualWidth = highlightPastedText ? cursorWidth : 0;
	const value = mask ? mask.repeat(originalValue.length) : originalValue;
	let renderedValue = value;
	let renderedPlaceholder = placeholder ? chalk.grey(placeholder) : undefined;

	if (showCursor && focus) {
		renderedPlaceholder =
			placeholder.length > 0
				? chalk.inverse(placeholder[0]) + chalk.grey(placeholder.slice(1))
				: chalk.inverse(' ');

		renderedValue = value.length > 0 ? '' : chalk.inverse(' ');

		let i = 0;

		for (const char of value) {
			if (i >= cursorOffset - cursorActualWidth && i <= cursorOffset) {
				renderedValue +=
					char === '\n' ? chalk.inverse(' ') + '\n' : chalk.inverse(char);
			} else {
				renderedValue += char;
			}

			i++;
		}

		if (value.length > 0 && cursorOffset === value.length) {
			renderedValue += chalk.inverse(' ');
		}
	}

	useInput(
		(input, key) => {
			if ((key.ctrl && input === 'c') || key.tab || (key.shift && key.tab)) {
				return;
			}

			// Multiline: Up/Down navigate between visual lines instead of history.
			// Visual lines include soft-wrapped rows — a single long line with no
			// \n that wraps at wrapWidth is still multiline for navigation.
			if (key.upArrow || key.downArrow) {
				const val = originalValueRef.current;
				const cur = cursorOffsetRef.current;
				if (!showCursor) {
					return;
				}

				const segments = getVisualLineSegments(val, wrapWidth);
				if (segments.length <= 1) {
					// Single visual line — parent's useInput handles history
					return;
				}

				const direction = key.upArrow ? 'up' : 'down';
				const next = moveCursorToVisualLine(segments, cur, direction);
				if (next === null) {
					// First/last visual line — hand off to history navigation
					onEdgeArrow?.(direction);
				} else {
					cursorOffsetRef.current = next;
					setState(s => ({...s, cursorOffset: next}));
				}
				return;
			}

			if (key.return) {
				if (handleEnter && onEnter) {
					onEnter(originalValueRef.current);
					return;
				}
				if (handleEnter && onSubmit) {
					onSubmit(originalValueRef.current);
					return;
				}
				return;
			}

			let nextCursorOffset = cursorOffsetRef.current;
			let nextValue = originalValueRef.current;
			let nextCursorWidth = 0;

			if (key.home) {
				nextCursorOffset = 0;
			} else if (key.end) {
				nextCursorOffset = originalValueRef.current.length;
			} else if (key.ctrl) {
				if (key.leftArrow) {
					// Ctrl+Left: jump to start of previous word
					if (showCursor) {
						nextCursorOffset = moveToPrevWord(
							originalValueRef.current,
							cursorOffsetRef.current,
						);
					}
				} else if (key.rightArrow) {
					// Ctrl+Right: jump to end of next word
					if (showCursor) {
						nextCursorOffset = moveToNextWord(
							originalValueRef.current,
							cursorOffsetRef.current,
						);
					}
				} else {
					// Readline keybinds
					switch (input) {
						case 'a': {
							// Move cursor to start of line
							nextCursorOffset = 0;
							break;
						}

						case 'e': {
							// Move cursor to end of line
							nextCursorOffset = originalValueRef.current.length;
							break;
						}

						case 'b': {
							// Move cursor back one character
							if (showCursor) {
								nextCursorOffset--;
							}

							break;
						}

						case 'f': {
							// Move cursor forward one character
							if (showCursor) {
								nextCursorOffset++;
							}

							break;
						}

						case 'w': {
							// Delete previous word (backward-kill-word, newline-aware)
							if (cursorOffsetRef.current > 0) {
								let i = cursorOffsetRef.current;
								while (
									i > 0 &&
									(originalValueRef.current[i - 1] === ' ' ||
										originalValueRef.current[i - 1] === '\n')
								)
									i--;
								while (
									i > 0 &&
									originalValueRef.current[i - 1] !== ' ' &&
									originalValueRef.current[i - 1] !== '\n'
								)
									i--;
								nextValue =
									originalValueRef.current.slice(0, i) +
									originalValueRef.current.slice(cursorOffsetRef.current);
								nextCursorOffset = i;
							}

							break;
						}

						case 'u': {
							// Delete from cursor to start of line
							nextValue = originalValueRef.current.slice(
								cursorOffsetRef.current,
							);
							nextCursorOffset = 0;
							break;
						}

						case 'k': {
							// Delete from cursor to end of line
							nextValue = originalValueRef.current.slice(
								0,
								cursorOffsetRef.current,
							);
							break;
						}

						default:
							// Ignore all other ctrl combinations (don't insert characters)
							break;
					}
				}
			} else if (key.leftArrow) {
				if (showCursor) {
					nextCursorOffset--;
				}
			} else if (key.rightArrow) {
				if (showCursor) {
					nextCursorOffset++;
				}
			} else if (key.backspace) {
				// Backspace deletes the character before the cursor.
				if (cursorOffsetRef.current > 0) {
					nextValue =
						originalValueRef.current.slice(0, cursorOffsetRef.current - 1) +
						originalValueRef.current.slice(
							cursorOffsetRef.current,
							originalValueRef.current.length,
						);
					nextCursorOffset--;
				}
			} else if (key.delete) {
				// Delete removes the character after the cursor (forward delete).
				if (cursorOffsetRef.current < originalValueRef.current.length) {
					nextValue =
						originalValueRef.current.slice(0, cursorOffsetRef.current) +
						originalValueRef.current.slice(
							cursorOffsetRef.current + 1,
							originalValueRef.current.length,
						);
					// Cursor stays in place — forward delete doesn't move it.
				}
			} else {
				nextValue =
					originalValueRef.current.slice(0, cursorOffsetRef.current) +
					input +
					originalValueRef.current.slice(
						cursorOffsetRef.current,
						originalValueRef.current.length,
					);
				nextCursorOffset += input.length;

				if (input.length > 1) {
					nextCursorWidth = input.length;
				}
			}

			if (nextCursorOffset < 0) {
				nextCursorOffset = 0;
			}

			if (nextCursorOffset > nextValue.length) {
				nextCursorOffset = nextValue.length;
			}

			// Update refs immediately so the next event in the same stdin.read()
			// block sees the correct values (Ink doesn't re-render between events)
			cursorOffsetRef.current = nextCursorOffset;
			setState({
				cursorOffset: nextCursorOffset,
				cursorWidth: nextCursorWidth,
			});

			if (nextValue !== originalValueRef.current) {
				originalValueRef.current = nextValue;
				onChange(nextValue);
			}
		},
		{isActive: focus},
	);

	const finalValue = placeholder
		? value.length > 0
			? renderedValue
			: renderedPlaceholder
		: renderedValue;

	const displayValue =
		wrapWidth && wrapWidth > 0 && finalValue
			? wrapWithTrimmedContinuations(finalValue, wrapWidth)
			: finalValue;

	return <Text>{displayValue}</Text>;
}

export default TextInput;
