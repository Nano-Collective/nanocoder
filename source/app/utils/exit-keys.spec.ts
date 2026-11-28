import test from 'ava';
import type {Key} from 'ink';
import type {InteractiveAppHandle} from '@/app/sections/interactive-app';
import {isExitKeyPress} from './exit-keys';

const ctrl = {ctrl: true} as Key;

function chatUI(handled: boolean, promptIsEmpty = false) {
	const calls: string[] = [];
	const chat: InteractiveAppHandle = {
		handleCtrlC: () => {
			calls.push('handleCtrlC');
			return handled;
		},
		promptIsEmpty: () => promptIsEmpty,
	};
	return {chat, calls};
}

const state = (chat: InteractiveAppHandle | null, extra = {}) => ({
	exiting: false,
	subagentAttached: false,
	chat,
	...extra,
});

test('Ctrl+C exits only when the chat UI does not use the press', t => {
	t.false(isExitKeyPress('c', ctrl, state(chatUI(true).chat)));
	t.true(isExitKeyPress('c', ctrl, state(chatUI(false).chat)));
});

test('Ctrl+C exits at once on screens without the chat UI', t => {
	t.true(isExitKeyPress('c', ctrl, state(null)));
});

test('Ctrl+C during shutdown force-quits without asking the chat UI', t => {
	const {chat, calls} = chatUI(true);
	t.true(isExitKeyPress('c', ctrl, state(chat, {exiting: true})));
	t.deepEqual(calls, []);
});

test('Ctrl+C is left to SubagentView while it is open', t => {
	// SubagentView is rendered instead of the chat UI, so its ref is null.
	t.false(isExitKeyPress('c', ctrl, state(null, {subagentAttached: true})));
});

test('Ctrl+D exits only from an empty prompt in the chat UI', t => {
	t.true(isExitKeyPress('d', ctrl, state(chatUI(true, true).chat)));
	t.false(isExitKeyPress('d', ctrl, state(chatUI(true, false).chat)));
	t.false(isExitKeyPress('d', ctrl, state(null)));
});

test('other keys never exit', t => {
	t.false(isExitKeyPress('c', {ctrl: false} as Key, state(null)));
	t.false(isExitKeyPress('s', ctrl, state(null)));
});
