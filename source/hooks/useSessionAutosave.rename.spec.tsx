import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {clearAppConfig} from '@/config/index';
import {sessionManager} from '@/session/session-manager';
import type {Message} from '@/types/core';
import {useSessionAutosave} from './useSessionAutosave';

type HookResult = ReturnType<typeof useSessionAutosave> & {
	setSessionId: (id: string | null) => void;
};

let root = '';

test.before(() => {
	root = mkdtempSync(join(tmpdir(), 'autosave-rename-'));
	const configDir = join(root, 'config');
	mkdirSync(configDir);
	writeFileSync(
		join(configDir, 'agents.config.json'),
		JSON.stringify({nanocoder: {sessions: {saveInterval: 1000}}}),
	);
	process.env.NANOCODER_CONFIG_DIR = configDir;
	process.env.NANOCODER_DATA_DIR = join(root, 'data');
	clearAppConfig();
});

test.after.always(() => {
	rmSync(root, {recursive: true, force: true});
});

function Harness({
	messages,
	onResult,
}: {
	messages: Message[];
	onResult: (result: HookResult) => void;
}) {
	const [sessionId, setSessionId] = React.useState<string | null>(null);
	const result = useSessionAutosave({
		messages,
		currentProvider: 'p',
		currentModel: 'm',
		currentSessionId: sessionId,
		setCurrentSessionId: setSessionId,
	});
	onResult({...result, setSessionId});
	return null;
}

function renderHook(messages: Message[]) {
	let hook: HookResult | null = null;
	const onResult = (result: HookResult) => {
		hook = result;
	};
	const rendered = render(<Harness messages={messages} onResult={onResult} />);
	return {
		get hook(): HookResult {
			if (!hook) throw new Error('hook did not render');
			return hook;
		},
		setMessages(next: Message[]) {
			rendered.rerender(<Harness messages={next} onResult={onResult} />);
		},
		unmount: rendered.unmount,
	};
}

const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

async function sessionTitled(title: string) {
	for (let i = 0; i < 60; i++) {
		const match = (await sessionManager.listSessions()).find(
			s => s.title === title,
		);
		if (match) return sessionManager.readSession(match.id);
		await wait(50);
	}
	return null;
}

const first: Message = {role: 'user', content: 'fix the login bug'};
const reply: Message = {role: 'assistant', content: 'done'};

test.serial('a renamed session keeps its name through the next autosave', async t => {
	const view = renderHook([first]);
	t.truthy(await sessionTitled('fix the login bug'));

	view.hook.renameSession('Sprint planning');
	view.setMessages([first, reply]);
	await wait(1300);

	const saved = await sessionTitled('Sprint planning');
	t.is(saved?.title, 'Sprint planning');
	t.true(saved?.titleManuallySet);
	t.is(saved?.messageCount, 2);
	view.unmount();
});

test.serial('the newest of two quick renames is the one saved', async t => {
	const view = renderHook([first]);
	t.truthy(await sessionTitled('fix the login bug'));

	view.hook.renameSession('Old name');
	view.hook.renameSession('Newest name');

	const saved = await sessionTitled('Newest name');
	t.is(saved?.title, 'Newest name');
	t.true(saved?.titleManuallySet);
	const titles = (await sessionManager.listSessions()).map(s => s.title);
	t.false(titles.includes('Old name'));
	view.unmount();
});

test.serial('a rename before the first save names the new session', async t => {
	const view = renderHook([]);
	await wait(50);
	view.hook.renameSession('Early name');
	view.setMessages([{role: 'user', content: 'add dark mode'}]);

	const saved = await sessionTitled('Early name');
	t.is(saved?.title, 'Early name');
	t.true(saved?.titleManuallySet);
	view.unmount();
});

test.serial('a pending rename is dropped when another session is resumed', async t => {
	const view = renderHook([]);
	await wait(50);
	view.hook.renameSession('Not for you');

	const resumed = await sessionManager.createSession({
		title: 'Resumed one',
		messageCount: 1,
		provider: 'p',
		model: 'm',
		workingDirectory: root,
		messages: [{role: 'user', content: 'Resumed one'}],
	});
	view.hook.setSessionId(resumed.id);
	await wait(50);
	view.setMessages([{role: 'user', content: 'Resumed one'}, reply]);
	await wait(1300);

	const saved = await sessionManager.readSession(resumed.id);
	t.is(saved?.title, 'Resumed one');
	t.falsy(saved?.titleManuallySet);
	t.is(saved?.messageCount, 2);
	view.unmount();
});
