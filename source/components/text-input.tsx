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
		internalValue: originalValue || '',
		cursorOffset: (originalValue || '').length,
		cursorWidth: 0,
	});

	const {internalValue, cursorOffset, cursorWidth} = state;

	// Refs so useInput handlers always read the latest values (avoids stale closures)
	const cursorOffsetRef = useRef(cursorOffset);
	const internalValueRef = useRef(internalValue);
	const pendingSentRef = useRef<string[]>([]);

	cursorOffsetRef.current = cursorOffset;
	internalValueRef.current = internalValue;

	useEffect(() => {
		if (!focus) {
			return;
		}

		const newValue = originalValue || '';

		// Check if this new value from props is one we recently sent via onChange
		const pendingIndex = pendingSentRef.current.indexOf(newValue);

		if (pendingIndex !== -1) {
			// It's an echo from the parent. Remove it and all older echoes from the queue.
			// We do NOT update our internal state, because we are ahead of the parent.
			pendingSentRef.current.splice(0, pendingIndex + 1);
		} else if (newValue !== internalValueRef.current) {
			// Parent programmatically changed the value (e.g. cleared it or loaded history)!
			// We must accept this new value and clamp our cursor to it.
			setState(s => ({
				...s,
				internalValue: newValue,
				cursorOffset: newValue.length,
				cursorWidth: 0,
			}));
			pendingSentRef.current = [];
		}
	}, [originalValue, focus]);

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
	const value = mask ? mask.repeat(internalValue.length) : internalValue;
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
				const val = internalValueRef.current;
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
					onEnter(internalValueRef.current);
					return;
				}
				if (handleEnter && onSubmit) {
					onSubmit(internalValueRef.current);
					return;
				}
				return;
			}

			let nextCursorOffset = cursorOffsetRef.current;
			let nextValue = internalValueRef.current;
			let nextCursorWidth = 0;

			if (key.home) {
				if (showCursor) {
					nextCursorOffset = 0;
				}
			} else if (key.end) {
				if (showCursor) {
					nextCursorOffset = internalValueRef.current.length;
				}
			} else if (key.ctrl) {
				if (key.leftArrow) {
					// Ctrl+Left: jump to start of previous word
					if (showCursor) {
						nextCursorOffset = moveToPrevWord(
							internalValueRef.current,
							cursorOffsetRef.current,
						);
					}
				} else if (key.rightArrow) {
					// Ctrl+Right: jump to end of next word
					if (showCursor) {
						nextCursorOffset = moveToNextWord(
							internalValueRef.current,
							cursorOffsetRef.current,
						);
					}
				} else {
					// Readline keybinds
					switch (input) {
						case 'a': {
							// Move cursor to start of line
							if (showCursor) {
								nextCursorOffset = 0;
							}
							break;
						}

						case 'e': {
							// Move cursor to end of line
							if (showCursor) {
								nextCursorOffset = internalValueRef.current.length;
							}
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
									(internalValueRef.current[i - 1] === ' ' ||
										internalValueRef.current[i - 1] === '\n')
								)
									i--;
								while (
									i > 0 &&
									internalValueRef.current[i - 1] !== ' ' &&
									internalValueRef.current[i - 1] !== '\n'
								)
									i--;
								nextValue =
									internalValueRef.current.slice(0, i) +
									internalValueRef.current.slice(cursorOffsetRef.current);
								nextCursorOffset = i;
							}

							break;
						}

						case 'u': {
							// Delete from cursor to start of line
							nextValue = internalValueRef.current.slice(
								cursorOffsetRef.current,
							);
							nextCursorOffset = 0;
							break;
						}

						case 'k': {
							// Delete from cursor to end of line
							nextValue = internalValueRef.current.slice(
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
			} else if (
				key.backspace ||
				(key.delete && (key.raw === '\x7f' || key.raw === '\x1b\x7f'))
			) {
				// Backspace deletes the character before the cursor.
				if (cursorOffsetRef.current > 0) {
					nextValue =
						internalValueRef.current.slice(0, cursorOffsetRef.current - 1) +
						internalValueRef.current.slice(
							cursorOffsetRef.current,
							internalValueRef.current.length,
						);
					nextCursorOffset--;
				}
			} else if (key.delete) {
				// Delete removes the character after the cursor (forward delete).
				if (cursorOffsetRef.current < internalValueRef.current.length) {
					nextValue =
						internalValueRef.current.slice(0, cursorOffsetRef.current) +
						internalValueRef.current.slice(
							cursorOffsetRef.current + 1,
							internalValueRef.current.length,
						);
					// Cursor stays in place — forward delete doesn't move it.
				}
			} else {
				nextValue =
					internalValueRef.current.slice(0, cursorOffsetRef.current) +
					input +
					internalValueRef.current.slice(
						cursorOffsetRef.current,
						internalValueRef.current.length,
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
			internalValueRef.current = nextValue;

			setState({
				internalValue: nextValue,
				cursorOffset: nextCursorOffset,
				cursorWidth: nextCursorWidth,
			});

			if (nextValue !== internalValue) {
				pendingSentRef.current.push(nextValue);
				// To prevent memory leak in case the parent never echoes, keep the queue bounded
				if (pendingSentRef.current.length > 200) {
					pendingSentRef.current.shift();
				}
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
