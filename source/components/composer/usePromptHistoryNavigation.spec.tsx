import '../../test-utils/isolated-config-dir';
import {writeFileSync} from 'node:fs';
import test from 'ava';
import {render} from 'ink-testing-library';
import React, {useState} from 'react';
import {getClosestConfigFile} from '../../config/index';
import {promptHistory} from '../../prompt-history';
import type {InputState} from '../../types/hooks';
import {usePromptHistoryNavigation} from './usePromptHistoryNavigation.js';

type Nav = ReturnType<typeof usePromptHistoryNavigation>;

const state = (displayValue: string): InputState => ({
	displayValue,
	placeholderContent: {},
});

async function seedHistory(prompts: string[]) {
	writeFileSync(
		getClosestConfigFile('.nano-coder-history'),
		'---JSON_FORMAT---[]',
		'utf8',
	);
	await promptHistory.loadHistory();
	for (const prompt of prompts) promptHistory.addPrompt(prompt);
	// The hook reloads history from disk on mount, so persist the seed.
	await promptHistory.saveHistory();
}

/**
 * Holds the input and history index the way useInputState does, so the hook
 * runs against real state transitions.
 */
function setup(draft: string) {
	let nav!: Nav;
	let shown = draft;
	let index = -1;
	let originalInput: string | null = null;
	let remounts = 0;
	function Probe() {
		const [current, setCurrent] = useState(state(draft));
		const [historyIndex, setHistoryIndex] = useState(-1);
		shown = current.displayValue;
		index = historyIndex;
		nav = usePromptHistoryNavigation({
			input: current.displayValue,
			currentState: current,
			historyIndex,
			setHistoryIndex,
			setOriginalInput: value => {
				originalInput = value;
			},
			setInputState: setCurrent,
			onInputReplaced: React.useCallback(() => {
				remounts++;
			}, []),
		});
		return null;
	}
	const view = render(<Probe />);
	return {
		get nav() {
			return nav;
		},
		get shown() {
			return shown;
		},
		get index() {
			return index;
		},
		get originalInput() {
			return originalInput;
		},
		get remounts() {
			return remounts;
		},
		async press(direction: 'up' | 'down') {
			nav.navigate(direction);
			await new Promise(resolve => setTimeout(resolve, 20));
		},
		unmount: view.unmount,
	};
}

test.serial('↑ walks back through history, then onto the draft, then wraps', async t => {
	await seedHistory(['first', 'second', 'third']);
	const s = setup('my draft');
	t.teardown(s.unmount);

	const seen: Array<[string, number]> = [];
	for (let i = 0; i < 5; i++) {
		await s.press('up');
		seen.push([s.shown, s.index]);
	}
	t.deepEqual(seen, [
		['third', 2],
		['second', 1],
		['first', 0],
		['my draft', -2],
		['third', 2],
	]);
	t.is(s.originalInput, 'my draft');
	t.is(s.remounts, 5);
});

test.serial('↓ from the prompt parks on the draft, then walks forward from the oldest', async t => {
	await seedHistory(['first', 'second']);
	const s = setup('draft');
	t.teardown(s.unmount);

	const seen: Array<[string, number]> = [];
	for (let i = 0; i < 4; i++) {
		await s.press('down');
		seen.push([s.shown, s.index]);
	}
	t.deepEqual(seen, [
		['draft', -2],
		['first', 0],
		['second', 1],
		['draft', -2],
	]);
});

test.serial('a recalled prompt is flagged until the user types', async t => {
	await seedHistory(['/zzcommand']);
	const s = setup('');
	t.teardown(s.unmount);

	t.false(s.nav.inputFromHistoryRef.current);
	await s.press('up');
	t.is(s.shown, '/zzcommand');
	t.true(s.nav.inputFromHistoryRef.current);

	s.nav.markTyped();
	t.false(s.nav.inputFromHistoryRef.current);
});

test.serial('with no history, ↑/↓ change nothing and do not flag the input', async t => {
	await seedHistory([]);
	const s = setup('kept');
	t.teardown(s.unmount);

	await s.press('up');
	await s.press('down');
	t.is(s.shown, 'kept');
	t.is(s.index, -1);
	t.is(s.remounts, 0);
	t.false(s.nav.inputFromHistoryRef.current);
});
