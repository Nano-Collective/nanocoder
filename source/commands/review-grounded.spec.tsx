import test from 'ava';
import stripAnsi from 'strip-ansi';
import {Box} from 'ink';
import React, {useState} from 'react';
import {commandRegistry} from '@/commands';
import {createReviewCommand} from './review';
import {useAppState} from '@/hooks/useAppState';
import {readPersistedReview} from '@/review/review-session';
import {
	createScriptedReviewClient,
	findingBlock,
	type ReviewScript,
	verdictBlock,
} from '@/review/review-client-test-helpers';
import {
	createReviewFixtureTools,
	createReviewGitFixture,
	type ReviewGitFixture,
} from '@/review/review-test-helpers';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import type {Message} from '@/types/core';
import type {MessageSubmissionOptions} from '@/types/index';
import {handleMessageSubmission} from '@/app/utils/app-util';
import {type ReviewFoundationTools} from '@/review/review-tools';

function tick(ms = 60): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
	const started = Date.now();
	while (!check()) {
		if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
		await tick(20);
	}
}

/** Mirrors the chat transcript plus live slot that the app renders. */
interface Screen {
	pushChat: (node: React.ReactNode) => void;
	setLive: (node: React.ReactNode) => void;
}

function ChatHarness({screen}: {screen: Screen}) {
	const [chat, setChat] = useState<React.ReactNode[]>([]);
	const [live, setLive] = useState<React.ReactNode>(null);
	screen.pushChat = node => setChat(items => [...items, node]);
	screen.setLive = setLive;
	return (
		<Box flexDirection="column">
			{chat.map((node, index) => (
				// biome-ignore lint/suspicious/noArrayIndexKey: append-only test transcript
				<Box key={index}>{node}</Box>
			))}
			{live}
		</Box>
	);
}

function HistoryHarness({history}: {
	history: {current?: ReturnType<typeof useAppState>};
}) {
	history.current = useAppState('normal');
	return null;
}

interface SessionState {
	messages: Message[];
	capture: boolean[];
	executing: boolean[];
	completed: number;
}

function mountReviewSession(script: ReviewScript) {
	const screen: Screen = {pushChat: () => {}, setLive: () => {}};
	const rendered = renderWithTheme(<ChatHarness screen={screen} />);
	const {client, calls} = createScriptedReviewClient(script);
	const state: SessionState = {messages: [], capture: [], executing: [], completed: 0};
	const options = {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onRenameSession: () => {},
		onEnterModelSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterSettingsMode: () => {},
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterTune: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: (node: React.ReactNode) => screen.pushChat(node),
		setLiveComponent: (node: React.ReactNode) => screen.setLive(node),
		setLiveComponentCapturesInput: (value: boolean) => state.capture.push(value),
		setIsToolExecuting: (value: boolean) => state.executing.push(value),
		onCommandComplete: () => {
			state.completed++;
		},
		setMessages: (messages: Message[]) => {
			state.messages = messages;
			options.messages = messages;
		},
		messages: [] as Message[],
		provider: 'review-test',
		providerConfig: null,
		client,
		model: 'review-test-model',
		theme: 'tokyo-night',
		updateInfo: null,
		getMessageTokens: () => 0,
	} satisfies Partial<MessageSubmissionOptions> as unknown as MessageSubmissionOptions;
	return {rendered, options, state, calls};
}

function registerReview(tools?: ReviewFoundationTools): void {
	commandRegistry.register(createReviewCommand(undefined, tools ? {tools} : {}));
}

function featureFixture(t: {teardown: (fn: () => void) => void}): ReviewGitFixture {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/tui']);
	fixture.write(
		'src/file.ts',
		'export function average(total: number, count: number) {\n\treturn total / count;\n}\n',
	);
	fixture.runGit(['add', '--all']);
	fixture.runGit(['commit', '-m', 'add average']);
	return fixture;
}

test.serial('the TUI shows live activity, toggles details, then renders and saves the report', async t => {
	const fixture = featureFixture(t);
	let releaseFinder: (() => void) | undefined;
	const finderGate = new Promise<void>(resolve => {
		releaseFinder = resolve;
	});
	const {rendered, options, state} = mountReviewSession(async (call, index) => {
		if (call.role === 'verifier') return {content: verdictBlock({})};
		if (index === 0) {
			return {toolCalls: [{name: 'review_read_file', args: {path: 'src/file.ts'}}]};
		}
		await finderGate;
		return {content: findingBlock({file: 'src/file.ts', line: 2})};
	});
	t.teardown(rendered.unmount);

	registerReview(createReviewFixtureTools(fixture));
	const running = handleMessageSubmission('/review branch feature/tui', options);
	await waitFor(() => stripAnsi(rendered.lastFrame() ?? '').includes('finder: turn 2') ?? false);
	await tick();

	const live = stripAnsi(rendered.lastFrame() ?? '');
	t.true(live.includes('$ /review branch feature/tui'));
	t.true(live.includes('Grounded review · running · 1 agent · 1 tool call · 2 model calls'));
	t.true(live.includes('D details · Esc cancel'));
	t.false(live.includes('args: src/file.ts'));
	t.deepEqual(state.capture, [true]);
	t.deepEqual(state.executing, [true]);

	rendered.stdin.write('d');
	await waitFor(() => stripAnsi(rendered.lastFrame() ?? '').includes('args: src/file.ts') ?? false);
	t.true(stripAnsi(rendered.lastFrame() ?? '').includes('tool: review_read_file'));

	releaseFinder?.();
	await running;
	await tick();

	const final = stripAnsi(rendered.lastFrame() ?? '');
	t.true(final.includes('Grounded review · completed · 2 agents · 1 tool call · 3 model calls'));
	t.true(final.includes('3 model calls · 1 tool call · 1 verifier run'));
	t.true(final.includes('Grounded review · completed'));
	t.true(final.includes('1 verified issue found.'));
	t.true(final.includes('src/file.ts:2'));
	t.false(final.includes('D details'));
	t.false(final.includes('## '));
	t.deepEqual(state.capture, [true, false]);
	t.deepEqual(state.executing, [true, false]);
	await waitFor(() => state.completed === 1);

	t.is(state.messages.length, 1);
	const saved = readPersistedReview(state.messages[0]!);
	t.is(saved?.status, 'completed');
	t.true(state.messages[0]!.displayOnly);
	t.true(saved?.activity.events.some(event => event.name === 'verifier F1'));
});

test.serial('Escape cancels a running review and the result says so', async t => {
	const fixture = featureFixture(t);
	const {rendered, options, state} = mountReviewSession(
		call =>
			new Promise((_resolve, reject) => {
				call.signal?.addEventListener('abort', () => {
					const error = new Error('aborted');
					error.name = 'AbortError';
					reject(error);
				});
			}),
	);
	t.teardown(rendered.unmount);

	registerReview(createReviewFixtureTools(fixture));
	const running = handleMessageSubmission('/review branch feature/tui', options);
	await waitFor(() => stripAnsi(rendered.lastFrame() ?? '').includes('finder: turn 1') ?? false);
	let settled = false;
	void running.then(() => {
		settled = true;
	});
	// Ink may hold a lone Escape briefly to tell it apart from an escape
	// sequence, so keep pressing until the review settles.
	await waitFor(() => {
		if (!settled) rendered.stdin.write('\u001B');
		return settled;
	});
	await tick();

	const final = stripAnsi(rendered.lastFrame() ?? '');
	t.regex(final, /Grounded review · cancelled/);
	t.true(final.includes('Review cancelled.'));
	t.false(final.includes('No verified issues'));
	t.is(readPersistedReview(state.messages[0]!)?.status, 'cancelled');
	t.deepEqual(state.capture, [true, false]);
});

test.serial('an incomplete review is labelled incomplete above its report', async t => {
	const fixture = featureFixture(t);
	const {rendered, options, state} = mountReviewSession(call =>
		call.role === 'verifier'
			? {content: 'I could not decide.'}
			: {content: findingBlock({file: 'src/file.ts', line: 2})},
	);
	t.teardown(rendered.unmount);

	registerReview(createReviewFixtureTools(fixture));
	await handleMessageSubmission('/review branch feature/tui', options);
	await tick();

	const final = stripAnsi(rendered.lastFrame() ?? '');
	t.true(final.includes('Grounded review · incomplete · 2 agents'));
	t.false(final.includes('Grounded review · completed · '));
	t.is(readPersistedReview(state.messages[0]!)?.status, 'incomplete');
});

test.serial('a second review cannot replace the running review or its Escape handler', async t => {
	const fixture = featureFixture(t);
	let releaseFinder: (() => void) | undefined;
	const {rendered, options, state} = mountReviewSession(
		call => new Promise((resolve, reject) => {
			releaseFinder = () => resolve({content: 'NO FINDINGS'});
			call.signal?.addEventListener('abort', () => {
				const error = new Error('aborted');
				error.name = 'AbortError';
				reject(error);
			});
		}),
	);
	t.teardown(() => {
		releaseFinder?.();
		rendered.unmount();
	});
	const installed: React.ReactNode[] = [];
	const setLive = options.setLiveComponent;
	options.setLiveComponent = node => {
		installed.push(node);
		setLive(node);
	};
	registerReview(createReviewFixtureTools(fixture));
	const running = handleMessageSubmission('/review branch feature/tui', options);
	await waitFor(() => stripAnsi(rendered.lastFrame() ?? '').includes('finder: turn 1') ?? false);
	const second = createScriptedReviewClient(() => ({content: 'NO FINDINGS'}));
	await handleMessageSubmission('/review branch feature/tui', {
		...options,
		client: second.client,
	});
	await waitFor(() => state.completed === 1);
	t.is(second.calls.length, 0);
	t.is(installed.length, 1);
	t.true(stripAnsi(rendered.lastFrame() ?? '').includes('A review is already running. Press Esc to cancel it first.'));
	t.deepEqual(state.capture, [true]);
	t.deepEqual(state.executing, [true]);
	let settled = false;
	void running.then(() => { settled = true; });
	await waitFor(() => {
		if (!settled) rendered.stdin.write('\u001B');
		return settled;
	});
	t.is(readPersistedReview(state.messages[0]!)?.status, 'cancelled');
	t.deepEqual(state.capture, [true, false]);
	t.deepEqual(state.executing, [true, false]);
	await handleMessageSubmission('/review branch feature/tui', {
		...options,
		client: second.client,
	});
	t.is(second.calls.length, 1);
});

test.serial('/review activity shows the saved trace of the latest review', async t => {
	const fixture = featureFixture(t);
	const {rendered, options} = mountReviewSession(() => ({content: 'NO FINDINGS'}));
	t.teardown(rendered.unmount);
	registerReview(createReviewFixtureTools(fixture));

	await handleMessageSubmission('/review branch feature/tui', options);
	await handleMessageSubmission('/review activity', options);
	await tick();

	const frame = stripAnsi(rendered.lastFrame() ?? '');
	t.true(frame.includes('Grounded review · completed · 1 agent'));
	t.true(frame.includes('review: Resolve review scope'));
	t.true(frame.includes('agent: finder'));
});

test.serial('a completed review appends to the latest real message history', async t => {
	const fixture = featureFixture(t);
	let releaseFinder: (() => void) | undefined;
	const gate = new Promise<void>(resolve => { releaseFinder = resolve; });
	const {rendered, options, calls} = mountReviewSession(async () => {
		await gate;
		return {content: 'NO FINDINGS'};
	});
	const history: {current?: ReturnType<typeof useAppState>} = {};
	const historyView = renderWithTheme(<HistoryHarness history={history} />);
	t.teardown(() => {
		releaseFinder?.();
		rendered.unmount();
		historyView.unmount();
	});
	const original: Message = {role: 'user', content: 'Original question'};
	const intervening: Message = {role: 'user', content: 'VS Code chat during review'};
	history.current!.updateMessages([original]);
	const submittedOptions = {
		...options,
		messages: [original],
		setMessages: history.current!.updateMessages,
		appendMessages: (messages: Message[]) => history.current!.appendMessages(messages),
	};
	registerReview(createReviewFixtureTools(fixture));
	const running = handleMessageSubmission('/review branch feature/tui', submittedOptions);
	await waitFor(() => calls.length === 1);
	history.current!.updateMessages([original, intervening]);
	await waitFor(() => history.current!.messages.length === 2);
	releaseFinder?.();
	await running;
	await waitFor(() => history.current!.messages.some(message => !!readPersistedReview(message)));
	t.deepEqual(history.current!.messages.slice(0, 2), [original, intervening]);
	t.is(history.current!.messages.length, 3);
	t.is(readPersistedReview(history.current!.messages[2]!)?.status, 'completed');
});

test.serial('/review runs the grounded review and /review quick the one-shot review', async t => {
	const quickGitCalls: string[][] = [];
	commandRegistry.register(
		createReviewCommand({
			execGit: async args => {
				quickGitCalls.push(args);
				return '';
			},
			getCurrentBranch: async () => 'feature',
			getDefaultBranch: async () => 'main',
		}),
	);
	const {rendered, options, state, calls} = mountReviewSession(() => ({content: 'NO FINDINGS'}));
	t.teardown(rendered.unmount);

	await handleMessageSubmission('/review quick main', options);
	t.true(quickGitCalls.some(args => args[0] === 'diff'));
	t.is(state.messages.length, 0);

	await handleMessageSubmission('/review please look at the thing I did', options);
	await tick();
	t.is(calls.length, 0);
	t.is(readPersistedReview(state.messages[0]!)?.status, 'clarification');
	t.true(stripAnsi(rendered.lastFrame() ?? '').includes('Grounded review · needs a target'));

	await handleMessageSubmission('/review deep please look at the thing I did', options);
	await tick();
	t.is(calls.length, 0);
	t.is(readPersistedReview(state.messages.at(-1)!)?.tier, 'Deep');
	t.true(stripAnsi(rendered.lastFrame() ?? '').includes('Deep review · needs a target'));
});
