import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
import type {Logger} from '@/utils/logging/types';
import type {ActiveEditorState} from '@/vscode/vscode-server';
import {
	useUserSubmit,
	useVSCodePromptDispatcher,
} from './useVSCodePromptHandling';

console.log('\nuseVSCodePromptHandling.spec.tsx');

interface CallSpy<T extends unknown[] = unknown[]> {
	(...args: T): void;
	calls: T[];
}

function spy<T extends unknown[] = unknown[]>(): CallSpy<T> {
	const fn = ((...args: T) => {
		fn.calls.push(args);
	}) as CallSpy<T>;
	fn.calls = [];
	return fn;
}

function makeLogger(): Logger {
	const noop = () => {};
	return {
		fatal: noop,
		error: noop,
		warn: noop,
		info: noop,
		http: noop,
		debug: noop,
		trace: noop,
		child: () => makeLogger(),
		isLevelEnabled: () => true,
		flush: async () => {},
		flushSync: () => {},
		end: async () => {},
	} as unknown as Logger;
}

test.afterEach(cleanup);

// ============================================================================
// useVSCodePromptDispatcher
// ============================================================================

let dispatcher: ReturnType<typeof useVSCodePromptDispatcher> | null = null;

function setupDispatcher() {
	dispatcher = null;
	function Probe() {
		dispatcher = useVSCodePromptDispatcher({logger: makeLogger()});
		return null;
	}
	render(<Probe />);
	if (!dispatcher) throw new Error('dispatcher did not initialize');
	return dispatcher as ReturnType<typeof useVSCodePromptDispatcher>;
}

test('dispatcher returns stable handleVSCodePrompt + bindMessageSubmit', t => {
	const d = setupDispatcher();
	t.is(typeof d.handleVSCodePrompt, 'function');
	t.is(typeof d.bindMessageSubmit, 'function');
});

test('handleVSCodePrompt without binding does not throw', t => {
	const d = setupDispatcher();
	t.notThrows(() => d.handleVSCodePrompt('hello'));
});

test('handleVSCodePrompt forwards plain prompts after binding', t => {
	const submit = spy<[string]>();
	const d = setupDispatcher();
	d.bindMessageSubmit(submit);

	d.handleVSCodePrompt('just a question');

	t.deepEqual(submit.calls, [['just a question']]);
});

test('handleVSCodePrompt augments prompt with selection + line range', t => {
	const submit = spy<[string]>();
	const d = setupDispatcher();
	d.bindMessageSubmit(submit);

	d.handleVSCodePrompt('explain this', {
		fileName: 'foo.ts',
		selection: 'const x = 1;',
		startLine: 10,
		endLine: 12,
	});

	t.is(submit.calls.length, 1);
	const sent = submit.calls[0]![0];
	t.regex(sent, /explain this/);
	t.regex(sent, /\[@foo\.ts \(lines 10-12\)\]/);
	t.regex(sent, /<!--vscode-context-->/);
	t.regex(sent, /const x = 1;/);
});

test('handleVSCodePrompt adds file pill when only fileName is present', t => {
	const submit = spy<[string]>();
	const d = setupDispatcher();
	d.bindMessageSubmit(submit);

	d.handleVSCodePrompt('what is this file?', {fileName: 'bar.ts'});

	const sent = submit.calls[0]![0];
	t.regex(sent, /\[@bar\.ts\]/);
	t.regex(sent, /<!--vscode-context-->/);
	t.notRegex(sent, /lines /);
});

test('handleVSCodePrompt rebinding swaps the active submit handler', t => {
	const first = spy<[string]>();
	const second = spy<[string]>();
	const d = setupDispatcher();

	d.bindMessageSubmit(first);
	d.handleVSCodePrompt('one');

	d.bindMessageSubmit(second);
	d.handleVSCodePrompt('two');

	t.deepEqual(first.calls, [['one']]);
	t.deepEqual(second.calls, [['two']]);
});

// ============================================================================
// useUserSubmit
// ============================================================================

let userSubmit: ((message: string) => Promise<void>) | null = null;

function setupUserSubmit({
	handleMessageSubmit,
	activeEditor,
}: {
	handleMessageSubmit: (message: string) => Promise<void>;
	activeEditor: ActiveEditorState | null;
}) {
	userSubmit = null;
	function Probe() {
		userSubmit = useUserSubmit({handleMessageSubmit, activeEditor});
		return null;
	}
	render(<Probe />);
	if (!userSubmit) throw new Error('userSubmit did not initialize');
	return userSubmit as (message: string) => Promise<void>;
}

test('useUserSubmit forwards plain message when no active editor', async t => {
	const submit = spy<[string]>();
	const submitAsync = async (m: string) => {
		submit(m);
	};
	const fn = setupUserSubmit({
		handleMessageSubmit: submitAsync,
		activeEditor: null,
	});

	await fn('hello world');

	t.deepEqual(submit.calls, [['hello world']]);
});

test('useUserSubmit appends file pill when an editor is focused', async t => {
	const submit = spy<[string]>();
	const fn = setupUserSubmit({
		handleMessageSubmit: async (m: string) => {
			submit(m);
		},
		activeEditor: {fileName: 'index.ts'} as ActiveEditorState,
	});

	await fn('what is this?');

	t.is(submit.calls.length, 1);
	const sent = submit.calls[0]![0];
	t.regex(sent, /what is this\?/);
	t.regex(sent, /\[@index\.ts\]/);
});

test('useUserSubmit inlines selection when one is present', async t => {
	const submit = spy<[string]>();
	const fn = setupUserSubmit({
		handleMessageSubmit: async (m: string) => {
			submit(m);
		},
		activeEditor: {
			fileName: 'app.ts',
			selection: 'foo()',
			startLine: 5,
			endLine: 5,
		} as ActiveEditorState,
	});

	await fn('what does this do?');

	const sent = submit.calls[0]![0];
	t.regex(sent, /\[@app\.ts \(lines 5-5\)\]/);
	t.regex(sent, /foo\(\)/);
});

test('useUserSubmit skips editor pill for bash commands', async t => {
	const submit = spy<[string]>();
	const fn = setupUserSubmit({
		handleMessageSubmit: async (m: string) => {
			submit(m);
		},
		activeEditor: {
			fileName: 'app.ts',
			selection: 'foo()',
			startLine: 5,
			endLine: 5,
		} as ActiveEditorState,
	});

	await fn('!ls -la');

	t.deepEqual(submit.calls, [['!ls -la']]);
});

test('useUserSubmit skips editor pill for slash commands', async t => {
	const submit = spy<[string]>();
	const fn = setupUserSubmit({
		handleMessageSubmit: async (m: string) => {
			submit(m);
		},
		activeEditor: {
			fileName: 'app.ts',
			selection: 'foo()',
			startLine: 5,
			endLine: 5,
		} as ActiveEditorState,
	});

	await fn('/clear');

	t.deepEqual(submit.calls, [['/clear']]);
});

test('useUserSubmit ignores editor with no fileName', async t => {
	const submit = spy<[string]>();
	const fn = setupUserSubmit({
		handleMessageSubmit: async (m: string) => {
			submit(m);
		},
		activeEditor: {selection: 'orphan'} as ActiveEditorState,
	});

	await fn('plain message');

	t.deepEqual(submit.calls, [['plain message']]);
});
