import type {Key} from 'ink';

/**
 * The composer's keymap: every named key binding UserInput dispatches, and the
 * `?` legend generated from it.
 *
 * Bindings that UserInput handles are declared once in COMPOSER_BINDINGS and
 * matched with `isComposerKey`. Each legend row names the bindings it
 * documents, or the component outside the composer that owns the key
 * (TextInput's readline keys, App's Ctrl+S / Ctrl+C, ...). keymap.spec.ts
 * checks every binding is documented by exactly one row, so a new binding
 * cannot ship without a legend entry.
 *
 * Write keys as `Ctrl+X`, the same notation the status line uses.
 */

type KeyMatcher = (input: string, key: Key) => boolean;

const ctrl =
	(letter: string): KeyMatcher =>
	(input, key) =>
		key.ctrl && input === letter;

export const COMPOSER_BINDINGS = {
	/** `?` toggles the shortcuts overlay (in an empty prompt; see UserInput). */
	toggleShortcuts: input => input === '?',
	toggleMode: (_input, key) => key.tab && key.shift,
	toggleCompactDisplay: ctrl('o'),
	// Ctrl+G is voice push-to-talk, so reasoning traces sit on Ctrl+N.
	toggleReasoningExpanded: ctrl('n'),
	toggleTaskList: ctrl('t'),
	reverseSearch: ctrl('r'),
	// Text pasted into the terminal arrives as a bracketed paste, never as a
	// Ctrl+V keypress, so Ctrl+V is free to mean "paste image".
	attachClipboardImage: ctrl('v'),
	removeLastImage: ctrl('x'),
	undo: ctrl('z'),
	redo: ctrl('y'),
} as const satisfies Record<string, KeyMatcher>;

export type ComposerBinding = keyof typeof COMPOSER_BINDINGS;

export function isComposerKey(
	binding: ComposerBinding,
	input: string,
	key: Key,
): boolean {
	return COMPOSER_BINDINGS[binding](input, key);
}

/**
 * Who handles a legend row's keys: named composer bindings, UserInput's own
 * Enter / arrow / Tab / Escape handling, or a component outside the composer.
 */
type LegendOwner =
	| {bindings: readonly ComposerBinding[]}
	| {
			component:
				| 'UserInput'
				| 'TextInput'
				| 'App'
				| 'InteractiveApp'
				| 'ChatHistory';
	  };

export interface LegendRow {
	keys: string;
	label: string;
	handledBy: LegendOwner;
}

export const KEYMAP_LEGEND: readonly LegendRow[] = [
	{keys: 'Enter', label: 'Submit prompt', handledBy: {component: 'UserInput'}},
	{
		keys: 'Ctrl+J / Opt+Enter',
		label: 'New line',
		handledBy: {component: 'TextInput'},
	},
	{
		keys: '↑ / ↓',
		label: 'Prompt history',
		handledBy: {component: 'UserInput'},
	},
	{
		keys: 'Tab',
		label: 'Accept suggestion / insert suggested command',
		handledBy: {component: 'UserInput'},
	},
	{
		keys: 'Ctrl+A / Ctrl+E',
		label: 'Move to start / end of line',
		handledBy: {component: 'TextInput'},
	},
	{
		keys: 'Ctrl+← / Ctrl+→',
		label: 'Move back / forward one word',
		handledBy: {component: 'TextInput'},
	},
	{
		keys: 'Ctrl+W',
		label: 'Delete previous word',
		handledBy: {component: 'TextInput'},
	},
	{
		keys: 'Ctrl+U / Ctrl+K',
		label: 'Delete to start / end of line',
		handledBy: {component: 'TextInput'},
	},
	{
		keys: 'Ctrl+Z / Ctrl+Y',
		label: 'Undo / redo the last edit',
		handledBy: {bindings: ['undo', 'redo']},
	},
	{
		keys: 'Esc Esc',
		label: 'Clear input (one Esc dismisses a suggested command)',
		handledBy: {component: 'UserInput'},
	},
	{
		keys: 'Ctrl+V / Ctrl+X',
		label: 'Attach clipboard image / remove last image',
		handledBy: {bindings: ['attachClipboardImage', 'removeLastImage']},
	},
	{
		keys: '↓ then Enter / Delete',
		label: 'Pick a queued message, then edit it / remove it',
		handledBy: {component: 'UserInput'},
	},
	{
		keys: 'Shift+Tab',
		label: 'Cycle development mode',
		handledBy: {bindings: ['toggleMode']},
	},
	{
		keys: 'Ctrl+O',
		label: 'Toggle compact tool output',
		handledBy: {bindings: ['toggleCompactDisplay']},
	},
	{
		keys: 'Ctrl+N',
		label: 'Toggle reasoning traces',
		handledBy: {bindings: ['toggleReasoningExpanded']},
	},
	{
		keys: 'Ctrl+R',
		label: 'Reverse search prompt history',
		handledBy: {bindings: ['reverseSearch']},
	},
	{
		keys: 'Ctrl+T',
		label: 'Collapse / expand task list',
		handledBy: {bindings: ['toggleTaskList']},
	},
	{
		keys: 'Ctrl+S',
		label: 'Attach / cycle running subagents',
		handledBy: {component: 'App'},
	},
	{
		keys: 'Ctrl+G',
		label: 'Voice push-to-talk (when /voice is on)',
		handledBy: {component: 'InteractiveApp'},
	},
	{
		keys: 'Esc',
		label: 'Cancel response (before it starts: back to your prompt)',
		handledBy: {component: 'InteractiveApp'},
	},
	{
		keys: 'PgUp / PgDn / wheel',
		label: 'Scroll the transcript (fullscreen)',
		handledBy: {component: 'ChatHistory'},
	},
	{keys: 'Ctrl+C', label: 'Exit', handledBy: {component: 'App'}},
	{
		keys: '?',
		label: 'Toggle this overlay (in an empty prompt)',
		handledBy: {bindings: ['toggleShortcuts']},
	},
];

/** The `?` overlay's rows, generated from the keymap. */
export const KEYBOARD_SHORTCUTS: ReadonlyArray<
	readonly [keybind: string, label: string]
> = KEYMAP_LEGEND.map(row => [row.keys, row.label] as const);
