import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {UIStateProvider} from '../../hooks/useUIState';
import type {InputState} from '../../types/hooks';
import {useCommandCompletions} from './useCommandCompletions.js';

type Commands = ReturnType<typeof useCommandCompletions>;

const COMMANDS = ['zzalpha', 'zzbeta', 'zzgamma'];

const state = (displayValue: string): InputState => ({
	displayValue,
	placeholderContent: {},
});

const settle = () => new Promise(resolve => setTimeout(resolve, 30));

interface ProbeProps {
	input: string;
	isMentionActive: boolean;
	fromHistory: boolean;
	latestStateRef: {current: InputState};
	setInputState: (s: InputState) => void;
	onInputReplaced: () => void;
	capture: (c: Commands) => void;
}

function Probe(props: ProbeProps) {
	const historyRef = React.useRef(props.fromHistory);
	historyRef.current = props.fromHistory;
	props.capture(
		useCommandCompletions({
			input: props.input,
			currentState: state(props.input),
			latestStateRef: props.latestStateRef,
			customCommands: COMMANDS,
			isMentionActive: props.isMentionActive,
			inputFromHistoryRef: historyRef,
			setInputState: props.setInputState,
			onInputReplaced: props.onInputReplaced,
		}),
	);
	return null;
}

function setup(initial: string, opts: {fromHistory?: boolean} = {}) {
	const replaced: InputState[] = [];
	let remounts = 0;
	let commands!: Commands;
	const latestStateRef = {current: state(initial)};
	let current = {
		input: initial,
		isMentionActive: false,
		fromHistory: opts.fromHistory ?? false,
	};
	const setInputState = (s: InputState) => {
		replaced.push(s);
	};
	const onInputReplaced = () => {
		remounts++;
	};
	const element = () => (
		<UIStateProvider>
			<Probe
				{...current}
				latestStateRef={latestStateRef}
				setInputState={setInputState}
				onInputReplaced={onInputReplaced}
				capture={c => {
					commands = c;
				}}
			/>
		</UIStateProvider>
	);
	const view = render(element());
	return {
		replaced,
		latestStateRef,
		get remounts() {
			return remounts;
		},
		get commands() {
			return commands;
		},
		async update(next: Partial<typeof current>) {
			current = {...current, ...next};
			latestStateRef.current = state(current.input);
			view.rerender(element());
			await settle();
		},
		/** Call a hook method, then let its state updates render. */
		async act<T>(fn: (c: Commands) => T): Promise<T> {
			const result = fn(commands);
			await settle();
			return result;
		},
		unmount: view.unmount,
	};
}

const names = (c: Commands) => c.items.map(item => item.name);

test.serial('typing a / prefix opens the menu with the matching commands', async t => {
	const s = setup('');
	t.teardown(s.unmount);
	await s.update({input: '/zz'});

	t.true(s.commands.isOpen);
	t.deepEqual(names(s.commands), COMMANDS);
	t.is(s.commands.selectedIndex, 0);

	await s.update({input: '/zzb'});
	t.deepEqual(names(s.commands), ['zzbeta']);
});

test.serial('arguments, plain text and an open @ mention close the menu', async t => {
	const s = setup('');
	t.teardown(s.unmount);

	for (const next of [
		{input: '/zzalpha some args'},
		{input: 'plain text'},
		{input: '/zz', isMentionActive: true},
	]) {
		await s.update({input: '/zz', isMentionActive: false});
		t.true(s.commands.isOpen);
		await s.update(next);
		t.false(s.commands.isOpen, JSON.stringify(next));
	}
});

test.serial('Escape keeps the menu closed for that input until the user types more', async t => {
	const s = setup('');
	t.teardown(s.unmount);
	await s.update({input: '/zz'});

	await s.act(c => c.dismiss());
	t.false(s.commands.isOpen);
	await s.update({input: '/zz'});
	t.false(s.commands.isOpen);

	await s.update({input: '/zza'});
	t.true(s.commands.isOpen);
});

test.serial('a command recalled from history does not open the menu', async t => {
	const s = setup('', {fromHistory: true});
	t.teardown(s.unmount);
	await s.update({input: '/zz'});
	t.false(s.commands.isOpen);
});

test.serial('↑/↓ move through the open menu and wrap', async t => {
	const s = setup('');
	t.teardown(s.unmount);
	t.false(s.commands.moveSelection('down'));

	await s.update({input: '/zz'});
	t.true(await s.act(c => c.moveSelection('up')));
	t.is(s.commands.selectedIndex, 2);
	t.true(await s.act(c => c.moveSelection('down')));
	t.is(s.commands.selectedIndex, 0);
});

test.serial('Tab selects the highlighted command and keeps the menu shut on it', async t => {
	const s = setup('');
	t.teardown(s.unmount);
	await s.update({input: '/zz'});
	await s.act(c => c.moveSelection('down'));

	t.true(await s.act(c => c.handleTab()));
	t.deepEqual(s.replaced, [state('/zzbeta')]);
	t.is(s.remounts, 1);
	t.false(s.commands.isOpen);

	// The parent applies the replacement; the menu must not re-open for it.
	await s.update({input: '/zzbeta'});
	t.false(s.commands.isOpen);
});

test.serial('Tab completes a single match without the menu, and ignores non-commands', async t => {
	const s = setup('');
	t.teardown(s.unmount);
	await s.update({input: '/zzg'});
	await s.act(c => c.dismiss());

	t.true(await s.act(c => c.handleTab()));
	t.deepEqual(s.replaced, [state('/zzgamma')]);

	await s.update({input: 'hello'});
	t.false(s.commands.handleTab());
	t.is(s.replaced.length, 1);
});

test.serial('Enter completes a fragment but lets a fully typed command submit', async t => {
	const s = setup('');
	t.teardown(s.unmount);

	await s.update({input: '/zza'});
	t.true(await s.act(c => c.completeOnEnter()));
	t.deepEqual(s.replaced, [state('/zzalpha')]);

	await s.update({input: '/zzalpha'});
	t.false(await s.act(c => c.completeOnEnter()));
	t.is(s.replaced.length, 1);
});

test.serial('Enter decides on the latest input when it arrives ahead of a render', async t => {
	const s = setup('');
	t.teardown(s.unmount);
	await s.update({input: 'hello'});

	// A fragment typed in the same stdin batch as Enter: state has it, the
	// render does not yet.
	s.latestStateRef.current = state('/zzg');
	t.true(await s.act(c => c.completeOnEnter()));
	t.deepEqual(s.replaced, [state('/zzgamma')]);
});

test.serial('suppressNextAutoShow keeps the menu shut for the next input change', async t => {
	const s = setup('');
	t.teardown(s.unmount);

	s.commands.suppressNextAutoShow();
	await s.update({input: '/zz'});
	t.false(s.commands.isOpen);

	await s.update({input: '/zza'});
	t.true(s.commands.isOpen);
});
