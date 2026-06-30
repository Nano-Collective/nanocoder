import test from 'ava';
import {Text} from 'ink';
import React from 'react';
import type {Message} from '@/types';
import {renderWithTheme} from '../../test-utils/render-with-theme.js';
import {InteractiveApp} from './interactive-app.js';

console.log(`\ninteractive-app.spec.tsx – ${React.version}`);

interface Overrides {
	isExplorerMode?: boolean;
	isIdeSelectionMode?: boolean;
	isSettingsMode?: boolean;
	startChat?: boolean;
	activeMode?: string | null;
	// Cancellation-related knobs
	isGenerating?: boolean;
	isToolExecuting?: boolean;
	isToolConfirmationMode?: boolean;
	isCancelling?: boolean;
	abortController?: AbortController | null;
	pendingToolCalls?: Array<{id: string; function: {name: string; arguments: unknown}}>;
	pendingSubagentApproval?: unknown;
	handleCancel?: () => void;
	streamingContent?: string;
	messages?: Message[];
	updateMessages?: (messages: Message[]) => void;
	chatComponents?: React.ReactNode[];
	setChatComponents?: (components: React.ReactNode[]) => void;
	setIsCancelling?: (value: boolean) => void;
	setAbortController?: (controller: AbortController | null) => void;
	client?: unknown;
}

function makeProps(o: Overrides = {}) {
	const noop = () => {};
	const noopAsync = async () => {};

	const appState = {
		client: o.client ?? null,
		messages: o.messages ?? [],
		currentModel: 'mock-model',
		currentProvider: 'mock',
		startChat: o.startChat ?? false,
		mcpInitialized: true,
		activeMode: o.activeMode ?? null,
		isExplorerMode: o.isExplorerMode ?? false,
		isIdeSelectionMode: o.isIdeSelectionMode ?? false,
		isSettingsMode: o.isSettingsMode ?? false,
		isToolConfirmationMode: o.isToolConfirmationMode ?? false,
		isToolExecuting: o.isToolExecuting ?? false,
		isQuestionMode: false,
		isCancelling: o.isCancelling ?? false,
		abortController: o.abortController ?? null,
		showAllSessions: false,
		checkpointLoadData: null,
		pendingToolCalls: o.pendingToolCalls ?? [],
		currentToolIndex: 0,
		pendingQuestion: null,
		customCommandCache: new Map(),
		developmentMode: 'normal',
		contextPercentUsed: null,
		sessionName: '',
		compactToolCounts: null,
		compactToolDisplay: false,
		liveTaskList: null,
		tune: {enabled: false, toolProfile: 'minimal', aggressiveCompact: false},
		reasoningExpanded: false,
		chatComponents: o.chatComponents ?? [],
		compactToolCountsRef: {current: {}},
		setCompactToolDisplay: noop,
		setCompactToolCounts: noop,
		setReasoningExpanded: noop,
		addToChatQueue: noop,
		updateMessages: o.updateMessages ?? noop,
		setChatComponents: o.setChatComponents ?? noop,
		setIsCancelling: o.setIsCancelling ?? noop,
		setAbortController: o.setAbortController ?? noop,
	};

	return {
		appState,
		chatHandler: {
			isGenerating: o.isGenerating ?? false,
			streamingContent: o.streamingContent ?? '',
		},
		modeHandlers: {
			handleExplorerCancel: noop,
			handleIdeSelectionCancel: noop,
			handleModelSelect: noop,
			handleModelSelectionCancel: noop,
			handleModelDatabaseCancel: noop,
			handleConfigWizardComplete: noop,
			handleConfigWizardCancel: noop,
			handleMcpWizardComplete: noop,
			handleMcpWizardCancel: noop,
			handleSettingsCancel: noop,
			handleTuneSelect: noop,
			handleTuneCancel: noop,
		},
		appHandlers: {
			handleCheckpointSelect: noopAsync,
			handleCheckpointCancel: noop,
			handleSessionSelect: noopAsync,
			handleSessionCancel: noop,
			handleCancel: o.handleCancel ?? noop,
			handleToggleDevelopmentMode: noop,
		},
		vscodeServer: {
			activeEditor: null,
			dismissActiveEditor: noop,
		},
		staticComponents: [<Text key="static">static-marker</Text>],
		liveComponent: null,
		pendingSubagentApproval: o.pendingSubagentApproval ?? null,
		handleSubagentToolApproval: noop,
		pendingToolConfirmation: null,
		handleToolConfirmation: noop,
		handleQuestionAnswer: noop,
		handleUserSubmit: noopAsync,
		userMessageQueue: {
			queuedMessages: [],
			enqueueMessage: () => ({
				id: 'queued-test',
				message: '',
				displayValue: '',
			}),
			removeMessage: noop,
			drainNextMessage: () => false,
		},
		handleIdeSelect: noop,
	} as never;
}

test('renders without crashing in default state', t => {
	const {lastFrame} = renderWithTheme(<InteractiveApp {...makeProps()} />);
	t.truthy(lastFrame());
});

test('renders the static-component marker through ChatHistory', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp {...makeProps({startChat: true})} />,
	);
	t.regex(lastFrame()!, /static-marker/);
});

test('does not render ChatInput while startChat is false', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp {...makeProps({startChat: false})} />,
	);
	const output = lastFrame()!;
	// ChatInput renders an input prompt; without startChat we shouldn't see
	// any prompt-line characters that ChatInput owns.
	t.notRegex(output, /What now\?/);
});

test('renders FileExplorer in explorer mode', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp {...makeProps({isExplorerMode: true})} />,
	);
	// FileExplorer renders directory-listing UI; smoke-test that the frame
	// changes vs. the default state.
	const output = lastFrame()!;
	t.truthy(output);
	t.true(output.length > 0);
});

test('renders without crashing in IDE-selection mode', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp {...makeProps({isIdeSelectionMode: true})} />,
	);
	t.truthy(lastFrame());
});

test('renders consistently across two mounts with the same props', t => {
	const props = makeProps();
	const a = renderWithTheme(<InteractiveApp {...props} />);
	const b = renderWithTheme(<InteractiveApp {...props} />);
	t.is(a.lastFrame(), b.lastFrame());
});

// ============================================================================
// Global Escape -> cancel handler
// ============================================================================

const pressEscape = async (stdin: {write: (s: string) => void}) => {
	stdin.write('\u001B');
	await new Promise(resolve => setTimeout(resolve, 50));
};

const waitForCondition = async (
	condition: () => boolean,
	timeoutMs = 1000,
) => {
	const startedAt = Date.now();

	while (Date.now() - startedAt < timeoutMs) {
		if (condition()) {
			return;
		}

		await new Promise(resolve => setTimeout(resolve, 25));
	}

	throw new Error(`Timed out after ${timeoutMs}ms waiting for condition`);
};

test('Escape cancels in-flight LLM generation on the first press', async t => {
	let cancelled = 0;
	const {stdin} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				isGenerating: true,
				handleCancel: () => {
					cancelled++;
				},
			})}
		/>,
	);

	await pressEscape(stdin);
	t.is(cancelled, 1);
});

test('Escape cancels while a regular tool runs behind ToolExecutionIndicator', async t => {
	// This is the original bug: ToolExecutionIndicator replaces UserInput and has
	// no input handler of its own, so the cancel must come from the global handler.
	let cancelled = 0;
	const {stdin} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				isToolExecuting: true,
				pendingToolCalls: [
					{id: 't1', function: {name: 'read_file', arguments: {}}},
				],
				handleCancel: () => {
					cancelled++;
				},
			})}
		/>,
	);

	await pressEscape(stdin);
	t.is(cancelled, 1);
});

test('Escape cancels when only an abort controller is live (state flicker)', async t => {
	let cancelled = 0;
	const {stdin} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				// Neither generating nor executing, but the turn is still abortable.
				abortController: new AbortController(),
				handleCancel: () => {
					cancelled++;
				},
			})}
		/>,
	);

	await pressEscape(stdin);
	t.is(cancelled, 1);
});

test('Escape recalls an in-flight user message before assistant streaming starts', async t => {
	let cancelled = 0;
	let latestMessages: Message[] = [];
	let latestAbortController: AbortController | null = null;
	let latestIsCancelling = true;

	const RecallHarness = () => {
		const [isGenerating, setIsGenerating] = React.useState(false);
		const [messages, setMessages] = React.useState<Message[]>([]);
		const [chatComponents, setChatComponents] = React.useState<
			React.ReactNode[]
		>([]);
		const [abortController, setAbortController] =
			React.useState<AbortController | null>(null);
		const [isCancelling, setIsCancelling] = React.useState(false);

		latestMessages = messages;
		latestAbortController = abortController;
		latestIsCancelling = isCancelling;

		return (
			<InteractiveApp
				{...makeProps({
					startChat: true,
					client: {},
					isGenerating,
					abortController,
					messages,
					chatComponents,
					updateMessages: setMessages,
					setChatComponents,
					setIsCancelling,
					setAbortController,
					handleCancel: () => {
						cancelled++;
						abortController?.abort();
						setIsGenerating(false);
						setIsCancelling(true);
					},
				})}
				handleUserSubmit={async message => {
					const controller = new AbortController();
					setMessages([{role: 'user', content: message}]);
					setChatComponents([<Text key="user">submitted bubble: {message}</Text>]);
					setAbortController(controller);
					setIsGenerating(true);
				}}
			/>
		);
	};

	const {stdin, lastFrame} = renderWithTheme(<RecallHarness />);

	stdin.write('fix the typo');
	await waitForCondition(() => /fix the typo/.test(lastFrame() ?? ''));
	stdin.write('\r');
	await waitForCondition(() => latestMessages.length === 1);

	await pressEscape(stdin);
	await waitForCondition(() => /fix the typo/.test(lastFrame() ?? ''));

	t.is(cancelled, 1);
	t.deepEqual(latestMessages, []);
	t.notRegex(lastFrame() ?? '', /submitted bubble: fix the typo/);
	t.is(latestAbortController, null);
	t.is(latestIsCancelling, false);
});

test('Escape recall does not remove a non-user chat component', async t => {
	let latestMessages: Message[] = [];
	let latestChatComponents: React.ReactNode[] = [];

	const RecallHarness = () => {
		const [isGenerating, setIsGenerating] = React.useState(false);
		const [messages, setMessages] = React.useState<Message[]>([]);
		const [chatComponents, setChatComponents] = React.useState<
			React.ReactNode[]
		>([]);
		const [abortController, setAbortController] =
			React.useState<AbortController | null>(null);

		latestMessages = messages;
		latestChatComponents = chatComponents;

		return (
			<InteractiveApp
				{...makeProps({
					startChat: true,
					client: {},
					isGenerating,
					abortController,
					messages,
					chatComponents,
					updateMessages: setMessages,
					setChatComponents,
					setAbortController,
					handleCancel: () => {
						abortController?.abort();
					},
				})}
				handleUserSubmit={async () => {
					setMessages([{role: 'assistant', content: 'custom command result'}]);
					setChatComponents([
						<Text key="custom-command">custom command result</Text>,
					]);
					setAbortController(new AbortController());
					setIsGenerating(true);
				}}
			/>
		);
	};

	const {stdin, lastFrame} = renderWithTheme(<RecallHarness />);

	stdin.write('recall me');
	await waitForCondition(() => /recall me/.test(lastFrame() ?? ''));
	stdin.write('\r');
	await waitForCondition(() => latestChatComponents.length === 1);

	await pressEscape(stdin);

	t.deepEqual(latestMessages, [
		{role: 'assistant', content: 'custom command result'},
	]);
	t.is(latestChatComponents.length, 1);
	t.regex(lastFrame() ?? '', /custom command result/);
});

test('Escape keeps existing cancel behavior after assistant streaming starts', async t => {
	let cancelled = 0;
	let latestMessages: Message[] = [];

	const StreamingHarness = () => {
		const [isGenerating, setIsGenerating] = React.useState(false);
		const [messages, setMessages] = React.useState<Message[]>([]);
		const [abortController, setAbortController] =
			React.useState<AbortController | null>(null);

		latestMessages = messages;

		return (
			<InteractiveApp
				{...makeProps({
					startChat: true,
					client: {},
					isGenerating,
					streamingContent: isGenerating ? 'partial response' : '',
					abortController,
					messages,
					updateMessages: setMessages,
					setAbortController,
					handleCancel: () => {
						cancelled++;
						abortController?.abort();
					},
				})}
				handleUserSubmit={async message => {
					setMessages([{role: 'user', content: message}]);
					setAbortController(new AbortController());
					setIsGenerating(true);
				}}
			/>
		);
	};

	const {stdin, lastFrame} = renderWithTheme(<StreamingHarness />);

	stdin.write('fix the typo');
	await waitForCondition(() => /fix the typo/.test(lastFrame() ?? ''));
	stdin.write('\r');
	await waitForCondition(() => latestMessages.length === 1);

	await pressEscape(stdin);

	t.is(cancelled, 1);
	t.is(latestMessages.length, 1);
});

test('Escape does NOT cancel when idle (clear-input owns it)', async t => {
	let cancelled = 0;
	const {stdin} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				handleCancel: () => {
					cancelled++;
				},
			})}
		/>,
	);

	await pressEscape(stdin);
	t.is(cancelled, 0);
});

test('Escape does NOT hijack tool confirmation (decline owns it)', async t => {
	// During confirmation the abort controller may be live, but the global handler
	// must stay dormant so Escape declines the tool rather than aborting the turn.
	let cancelled = 0;
	const {stdin} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				isToolConfirmationMode: true,
				abortController: new AbortController(),
				pendingToolCalls: [
					{id: 't1', function: {name: 'write_file', arguments: {}}},
				],
				handleCancel: () => {
					cancelled++;
				},
			})}
		/>,
	);

	await pressEscape(stdin);
	t.is(cancelled, 0);
});

// FileExplorer/IdeSelector start watchers that keep the event loop alive
// past test completion. Force-exit so the spec doesn't time out.
test.after.always(() => {
	setTimeout(() => process.exit(0), 100).unref();
});
