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
	// Plan review knobs
	planReviewState?: {show: boolean; originalMessage: string} | null;
	setPlanReviewState?: (v: {show: boolean; originalMessage: string} | null) => void;
	isConversationComplete?: boolean;
	developmentMode?: string;
	planTurnCompleted?: boolean;
	setPlanTurnCompleted?: (v: boolean) => void;
	pendingPlanProceed?: boolean;
	setPendingPlanProceed?: (v: boolean) => void;
	handleMessageSubmit?: (message: string) => Promise<void>;
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
		planReviewState: o.planReviewState ?? null,
		setPlanReviewState: o.setPlanReviewState ?? noop,
		planTurnCompleted: o.planTurnCompleted ?? false,
		setPlanTurnCompleted: o.setPlanTurnCompleted ?? noop,
		pendingPlanProceed: o.pendingPlanProceed ?? false,
		setPendingPlanProceed: o.setPendingPlanProceed ?? noop,
		isConversationComplete: o.isConversationComplete ?? false,
		developmentMode: o.developmentMode ?? 'normal',
		customCommandCache: new Map(),
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
			handleMessageSubmit: o.handleMessageSubmit ?? noopAsync,
			handlePlanProceed: noop,
			handlePlanAskMore: noopAsync,
			handlePlanModify: noop,
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

// Lets mount effects (plan review signal / proceed dispatch) run and settle.
const tickInteractive = () =>
	new Promise(resolve => setTimeout(resolve, 30));

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

// ============================================================================
// Plan review bar
// ============================================================================

test('plan review bar is shown when planReviewState.show is true', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				planReviewState: {show: true, originalMessage: 'add auth'},
			})}
		/>,
	);
	t.regex(lastFrame()!, /Plan ready/);
});

test('plan review bar shows when the planTurnCompleted signal fires', async t => {
	let shown: {show: boolean; originalMessage: string} | null = null;
	let resetToFalse = false;
	renderWithTheme(
		<InteractiveApp
			{...makeProps({
				planTurnCompleted: true,
				planReviewState: null,
				setPlanReviewState: v => {
					shown = v;
				},
				setPlanTurnCompleted: v => {
					if (v === false) resetToFalse = true;
				},
			})}
		/>,
	);
	await tickInteractive();
	t.deepEqual(shown, {show: true, originalMessage: ''});
	// The one-shot signal must be reset after consumption.
	t.true(resetToFalse);
});

// Regression: the bar used to be inferred from (isConversationComplete + current
// mode). Switching into plan mode while a prior turn was already complete popped
// it up with no plan behind it. It must now ONLY show on the explicit signal.
test('plan review bar does NOT show from idle completion in plan mode (no signal)', async t => {
	let setPlanCalls = 0;
	renderWithTheme(
		<InteractiveApp
			{...makeProps({
				planTurnCompleted: false, // no signal — just idle-complete in plan mode
				planReviewState: null,
				isConversationComplete: true,
				developmentMode: 'plan',
				setPlanReviewState: () => {
					setPlanCalls++;
				},
			})}
		/>,
	);
	await tickInteractive();
	t.is(setPlanCalls, 0);
});

// Proceed defers the "implement" dispatch until the mode switch to normal has
// propagated, so the executing turn runs with normal-mode tools/prompt.
test('Proceed dispatches the implement message once mode is normal', async t => {
	const submitted: string[] = [];
	let pendingReset = false;
	renderWithTheme(
		<InteractiveApp
			{...makeProps({
				pendingPlanProceed: true,
				developmentMode: 'normal',
				setPendingPlanProceed: v => {
					if (v === false) pendingReset = true;
				},
				handleMessageSubmit: async m => {
					submitted.push(m);
				},
			})}
		/>,
	);
	await tickInteractive();
	t.is(submitted.length, 1);
	t.regex(submitted[0], /approved.*implement/i);
	t.true(pendingReset);
});

test('Proceed does NOT dispatch while still in plan mode', async t => {
	const submitted: string[] = [];
	renderWithTheme(
		<InteractiveApp
			{...makeProps({
				pendingPlanProceed: true,
				developmentMode: 'plan',
				handleMessageSubmit: async m => {
					submitted.push(m);
				},
			})}
		/>,
	);
	await tickInteractive();
	t.is(submitted.length, 0);
});

test('ChatInput is NOT rendered while plan review bar is showing', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				planReviewState: {show: true, originalMessage: 'add auth'},
			})}
		/>,
	);
	const output = lastFrame()!;
	// Plan bar is present.
	t.regex(output, /Plan ready/);
	// The ChatInput prompt line should be absent — both inputs must not be
	// active at the same time (double-input blocker).
	t.notRegex(output, /What now\?/);
});

// FileExplorer/IdeSelector start watchers that keep the event loop alive
// past test completion. Force-exit so the spec doesn't time out.
test.after.always(() => {
	setTimeout(() => process.exit(0), 100).unref();
});
