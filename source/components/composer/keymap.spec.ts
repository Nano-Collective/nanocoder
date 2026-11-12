import test from 'ava';
import type {Key} from 'ink';
import {
	COMPOSER_BINDINGS,
	type ComposerBinding,
	isComposerKey,
	KEYBOARD_SHORTCUTS,
	KEYMAP_LEGEND,
} from './keymap.js';

const noKey: Key = {
	upArrow: false,
	downArrow: false,
	leftArrow: false,
	rightArrow: false,
	pageDown: false,
	pageUp: false,
	home: false,
	end: false,
	return: false,
	escape: false,
	ctrl: false,
	shift: false,
	tab: false,
	backspace: false,
	delete: false,
	meta: false,
	super: false,
	hyper: false,
	capsLock: false,
	numLock: false,
};

const press = (input: string, key: Partial<Key> = {}) =>
	[input, {...noKey, ...key}] as const;

// The keypress each binding answers to, as Ink reports it.
const BINDING_KEYS: Record<ComposerBinding, readonly [string, Key]> = {
	toggleShortcuts: press('?'),
	toggleMode: press('', {tab: true, shift: true}),
	toggleCompactDisplay: press('o', {ctrl: true}),
	toggleReasoningExpanded: press('n', {ctrl: true}),
	toggleTaskList: press('t', {ctrl: true}),
	reverseSearch: press('r', {ctrl: true}),
	attachClipboardImage: press('v', {ctrl: true}),
	removeLastImage: press('x', {ctrl: true}),
	undo: press('z', {ctrl: true}),
	redo: press('y', {ctrl: true}),
};

test('each binding matches its own key and no other binding does', t => {
	const bindings = Object.keys(COMPOSER_BINDINGS) as ComposerBinding[];
	for (const pressed of bindings) {
		const [input, key] = BINDING_KEYS[pressed];
		for (const binding of bindings) {
			t.is(
				isComposerKey(binding, input, key),
				binding === pressed,
				`${binding} vs a ${pressed} keypress`,
			);
		}
	}
});

test('Ctrl bindings need Ctrl, and a bare Tab is not Shift+Tab', t => {
	t.false(isComposerKey('undo', ...press('z')));
	t.false(isComposerKey('reverseSearch', ...press('r')));
	t.false(isComposerKey('toggleMode', ...press('', {tab: true})));
});

test('every composer binding is documented by exactly one legend row', t => {
	const documented = KEYMAP_LEGEND.flatMap(row =>
		'bindings' in row.handledBy ? row.handledBy.bindings : [],
	);
	t.deepEqual(
		[...documented].sort(),
		Object.keys(COMPOSER_BINDINGS).sort(),
	);
});

// The hand-maintained legend this keymap replaced (#2075), kept verbatim:
// generating the legend must not change a single row or its order.
const LEGACY_LEGEND: Array<[string, string]> = [
	['Enter', 'Submit prompt'],
	['Ctrl+J / Opt+Enter', 'New line'],
	['↑ / ↓', 'Prompt history'],
	['Tab', 'Accept suggestion / insert suggested command'],
	['Ctrl+A / Ctrl+E', 'Move to start / end of line'],
	['Ctrl+← / Ctrl+→', 'Move back / forward one word'],
	['Ctrl+W', 'Delete previous word'],
	['Ctrl+U / Ctrl+K', 'Delete to start / end of line'],
	['Ctrl+Z / Ctrl+Y', 'Undo / redo the last edit'],
	['Esc Esc', 'Clear input (one Esc dismisses a suggested command)'],
	['Ctrl+V / Ctrl+X', 'Attach clipboard image / remove last image'],
	['↓ then Enter / Delete', 'Pick a queued message, then edit it / remove it'],
	['Shift+Tab', 'Cycle development mode'],
	['Ctrl+O', 'Toggle compact tool output'],
	['Ctrl+N', 'Toggle reasoning traces'],
	['Ctrl+R', 'Reverse search prompt history'],
	['Ctrl+T', 'Collapse / expand task list'],
	['Ctrl+S', 'Attach / cycle running subagents'],
	['Ctrl+G', 'Voice push-to-talk (when /voice is on)'],
	['Esc', 'Cancel response (before it starts: back to your prompt)'],
	['PgUp / PgDn / wheel', 'Scroll the transcript (fullscreen)'],
	['Ctrl+C', 'Exit'],
	['?', 'Toggle this overlay (in an empty prompt)'],
];

test('the generated legend matches the hand-maintained one it replaced', t => {
	t.deepEqual(
		KEYBOARD_SHORTCUTS.map(([keys, label]) => [keys, label]),
		LEGACY_LEGEND,
	);
});
