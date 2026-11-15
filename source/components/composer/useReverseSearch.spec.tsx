import '../../test-utils/isolated-config-dir';
import {writeFileSync} from 'node:fs';
import test from 'ava';
import type {Key} from 'ink';
import {render} from 'ink-testing-library';
import React from 'react';
import {getClosestConfigFile} from '../../config/index';
import {promptHistory} from '../../prompt-history';
import type {InputState} from '../../types/hooks';
import {
	findReverseMatch,
	type ReverseSearchExit,
	useReverseSearch,
} from './useReverseSearch.js';

type Search = ReturnType<typeof useReverseSearch>;

const noKey = {
	upArrow: false,
	downArrow: false,
	leftArrow: false,
	rightArrow: false,
	return: false,
	escape: false,
	ctrl: false,
	meta: false,
	tab: false,
	backspace: false,
	delete: false,
} as Key;

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
}

function Probe({capture}: {capture: (search: Search) => void}) {
	capture(useReverseSearch());
	return null;
}

function setup() {
	let search!: Search;
	const view = render(
		<Probe
			capture={s => {
				search = s;
			}}
		/>,
	);
	const settle = () => new Promise(resolve => setTimeout(resolve, 20));
	return {
		get search() {
			return search;
		},
		async start(draft: InputState) {
			search.start(draft);
			await settle();
		},
		async key(input: string, key: Partial<Key> = {}) {
			const exit: ReverseSearchExit | null = search.handleKey(input, {
				...noKey,
				...key,
			});
			await settle();
			return exit;
		},
		async type(text: string) {
			for (const char of text) {
				search.handleKey(char, noKey);
				await settle();
			}
		},
		unmount: view.unmount,
	};
}

test('findReverseMatch searches backwards from startIndex, case-insensitively', t => {
	const history = ['git status', 'npm test', 'Git push'].map(state);
	t.is(findReverseMatch(history, 'git', 2)?.index, 2);
	t.is(findReverseMatch(history, 'git', 1)?.index, 0);
	t.is(findReverseMatch(history, 'missing', 2), null);
	t.is(findReverseMatch([], 'git', 0), null);
});

test.serial('start shows the newest prompt for the empty query', async t => {
	await seedHistory(['older', 'newest']);
	const s = setup();
	t.teardown(s.unmount);

	t.false(s.search.isActive);
	await s.start(state('my draft'));
	t.true(s.search.isActive);
	t.is(s.search.query, '');
	t.is(s.search.match?.displayValue, 'newest');
});

test.serial('typing narrows the match; Backspace widens it again', async t => {
	await seedHistory(['deploy prod', 'run tests', 'deploy staging']);
	const s = setup();
	t.teardown(s.unmount);

	await s.start(state(''));
	await s.type('test');
	t.is(s.search.query, 'test');
	t.is(s.search.match?.displayValue, 'run tests');

	await s.type('zz');
	t.is(s.search.match, null);

	await s.key('', {backspace: true});
	await s.key('', {backspace: true});
	t.is(s.search.query, 'test');
	t.is(s.search.match?.displayValue, 'run tests');
});

test.serial('Ctrl+R cycles to older matches and stops at the oldest', async t => {
	await seedHistory(['echo one', 'other', 'echo two', 'echo three']);
	const s = setup();
	t.teardown(s.unmount);

	await s.start(state(''));
	await s.type('echo');
	t.is(s.search.match?.displayValue, 'echo three');
	await s.key('r', {ctrl: true});
	t.is(s.search.match?.displayValue, 'echo two');
	await s.key('r', {ctrl: true});
	t.is(s.search.match?.displayValue, 'echo one');
	await s.key('r', {ctrl: true});
	t.is(s.search.match?.displayValue, 'echo one');
});

test.serial('Enter exits with the match; Escape exits with the draft', async t => {
	await seedHistory(['picked prompt']);
	const s = setup();
	t.teardown(s.unmount);

	await s.start(state('draft'));
	const accepted = await s.key('', {return: true});
	t.is(accepted?.restore?.displayValue, 'picked prompt');
	t.false(s.search.isActive);
	t.is(s.search.query, '');
	t.is(s.search.match, null);

	await s.start(state('draft'));
	await s.type('picked');
	const cancelled = await s.key('', {escape: true});
	t.is(cancelled?.restore?.displayValue, 'draft');
	t.false(s.search.isActive);
});

test.serial('Enter with no match exits without anything to restore', async t => {
	await seedHistory(['something']);
	const s = setup();
	t.teardown(s.unmount);

	await s.start(state('draft'));
	await s.type('nomatch');
	const exit = await s.key('', {return: true});
	t.deepEqual(exit, {restore: null});
});

test.serial('arrows, Tab and other Ctrl/Meta keys are swallowed without changing the query', async t => {
	await seedHistory(['abc']);
	const s = setup();
	t.teardown(s.unmount);

	await s.start(state(''));
	await s.type('a');
	for (const key of [
		{upArrow: true},
		{downArrow: true},
		{leftArrow: true},
		{rightArrow: true},
		{tab: true},
	]) {
		t.is(await s.key('x', key), null);
	}
	t.is(await s.key('w', {ctrl: true}), null);
	t.is(await s.key('b', {meta: true}), null);
	t.is(s.search.query, 'a');
	t.true(s.search.isActive);
});
