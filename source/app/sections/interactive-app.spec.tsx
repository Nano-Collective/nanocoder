import test from 'ava';
import {Text} from 'ink';
import React from 'react';
import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {useUserMessageQueue} from '@/hooks/useUserMessageQueue';
import stripAnsi from 'strip-ansi';
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
	liveComponentCapturesInput?: boolean;
	isToolConfirmationMode?: boolean;
	isCancelling?: boolean;
	abortController?: AbortController | null;
	altScreenActive?: boolean;
	pendingToolCalls?: Array<{id: string; function: {name: string; arguments: unknown}}>;
	pendingSubagentApproval?: unknown;
	handleCancel?: () => void;
	streamingContent?: string;
	messages?: Message[];
	updateMessages?: (messages: Message[]) => void;
	chatComponents?: React.ReactNode[];
	setChatComponents?: (components: React.ReactNode[]) => void;
	addToChatQueue?: (component: React.ReactNode) => void;
	setIsCancelling?: (value: boolean) => void;
	setAbortController?: (controller: AbortController | null) => void;
	client?: unknown;
	// Plan review knobs
	planReviewState?: {show: boolean; originalMessage: string} | null;
	setPlanReviewState?: (v: {show: boolean; originalMessage: string} | null) => void;
	// Architect review knobs
	architectReviewState?: {
		show: boolean;
		checkpointName: string;
		filesChanged: string[];
		filesMissing: string[];
	} | null;
	isConversationComplete?: boolean;
	developmentMode?: string;
	planTurnCompleted?: boolean;
	setPlanTurnCompleted?: (v: boolean) => void;
	pendingPlanProceed?: string | null;
	setPendingPlanProceed?: (v: string | null) => void;
	handleMessageSubmit?: (message: string) => Promise<void>;
	currentSessionId?: string | null;
	toolManager?: unknown;
	queuedMessages?: Array<{id: string; message: string; displayValue: string}>;
	handleUserSubmit?: (message: string) => Promise<void>;
	drainNextMessage?: (
		dispatch: (message: {id: string; message: string; displayValue: string}) =>
			boolean | Promise<boolean>,
	) => boolean | Promise<boolean>;
}

function makeProps(o: Overrides = {}) {
	const noop = () => {};
	const noopAsync = async () => {};

	const appState = {
		client: o.client ?? null,
		toolManager: o.toolManager ?? null,
		messages: o.messages ?? [],
		currentModel: 'mock-model',
		currentProvider: 'mock',
		currentSessionId: o.currentSessionId ?? null,
		startChat: o.startChat ?? false,
		mcpInitialized: true,
		activeMode: o.activeMode ?? null,
		isExplorerMode: o.isExplorerMode ?? false,
		isIdeSelectionMode: o.isIdeSelectionMode ?? false,
		isSettingsMode: o.isSettingsMode ?? false,
		isToolConfirmationMode: o.isToolConfirmationMode ?? false,
		isToolExecuting: o.isToolExecuting ?? false,
		liveComponentCapturesInput: o.liveComponentCapturesInput ?? false,
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
		architectReviewState: o.architectReviewState ?? null,
		setArchitectReviewState: noop,
		planTurnCompleted: o.planTurnCompleted ?? false,
		setPlanTurnCompleted: o.setPlanTurnCompleted ?? noop,
		pendingPlanProceed: o.pendingPlanProceed ?? null,
		setPendingPlanProceed: o.setPendingPlanProceed ?? noop,
		isConversationComplete: o.isConversationComplete ?? false,
		developmentMode: o.developmentMode ?? 'normal',
		customCommandCache: new Map(),
		contextPercentUsed: null,
		sessionName: '',
		compactToolCounts: null,
		compactToolDisplay: false,
		liveTaskList: null,
		showTaskList: true,
		taskListHasUnread: false,
		toggleTaskList: noop,
		tune: {enabled: false, toolProfile: 'minimal', aggressiveCompact: false},
		reasoningExpanded: false,
		chatComponents: o.chatComponents ?? [],
		compactToolCountsRef: {current: {}},
		setCompactToolDisplay: noop,
		setCompactToolCounts: noop,
		setReasoningExpanded: noop,
		addToChatQueue: o.addToChatQueue ?? noop,
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
			handlePlanModify: noop,
			handleArchitectKeep: noopAsync,
			handleArchitectRevert: noopAsync,
			handleArchitectRevertAndRevise: noopAsync,
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
		handleUserSubmit: o.handleUserSubmit ?? noopAsync,
		userMessageQueue: {
			queuedMessages: o.queuedMessages ?? [],
			enqueueMessage: () => ({
				id: 'queued-test',
				message: '',
				displayValue: '',
			}),
			removeMessage: noop,
			drainNextMessage: o.drainNextMessage ?? (async () => false),
		},
		handleIdeSelect: noop,
		altScreenActive: o.altScreenActive ?? false,
	} as never;
}

function QueuedPromptHarness({overrides}: {overrides: Overrides}) {
	const userMessageQueue = useUserMessageQueue();

	React.useEffect(() => {
		userMessageQueue.enqueueMessage({
			message: 'queued prompt',
			displayValue: 'queued prompt',
		});
	}, [userMessageQueue.enqueueMessage]);

	return (
		<InteractiveApp
			{...makeProps(overrides)}
			userMessageQueue={userMessageQueue}
		/>
	);
}

test('renders without crashing in default state', t => {
	const {lastFrame} = renderWithTheme(<InteractiveApp {...makeProps()} />);
	t.truthy(lastFrame());
});

test('does not drain queued prompts while a turn is generating', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: {},
				isGenerating: true,
				isConversationComplete: true,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('does not drain queued prompts while a modal mode is active', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: {},
				activeMode: 'model',
				isConversationComplete: true,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('does not drain queued prompts while plan review is active', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: {},
				planReviewState: {show: true, originalMessage: 'make a plan'},
				isConversationComplete: true,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('does not drain queued prompts while architect review is active', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: {},
				developmentMode: 'architect',
				architectReviewState: {
					show: true,
					checkpointName: 'architect-checkpoint',
					filesChanged: ['source/a.ts'],
					filesMissing: [],
				},
				// The architect gate opens at turn completion, so the turn really is
				// idle and complete while the keep/revert bar is up. Only the gate
				// itself can hold the queue back.
				isConversationComplete: true,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('does not drain queued prompts while plan proceed is pending', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: {},
				developmentMode: 'plan',
				pendingPlanProceed: 'approved plan',
				isConversationComplete: true,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('does not immediately retry a failed queued dispatch', async t => {
	let dispatchAttempts = 0;
	const notices: React.ReactNode[] = [];
	let releaseFailure = () => {};
	const failure = new Promise<void>(resolve => {
		releaseFailure = () => resolve();
	});
	let signalFirstDispatch = () => {};
	const firstDispatchStarted = new Promise<void>(resolve => {
		signalFirstDispatch = () => resolve();
	});
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: {},
				isConversationComplete: true,
				addToChatQueue: notice => {
					notices.push(notice);
				},
				handleUserSubmit: async () => {
					dispatchAttempts++;
					signalFirstDispatch();
					await failure;
					throw new Error('dispatch failed');
				},
			}}
		/>,
	);

	t.teardown(unmount);
	await firstDispatchStarted;
	// Let the queue removal commit before the failed dispatch is released. This
	// is the render boundary that a synchronous throw would collapse away.
	await new Promise(resolve => setTimeout(resolve, 0));
	releaseFailure();
	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 1);
	t.is(notices.length, 1);
	const notice = notices[0];
	t.true(React.isValidElement(notice));
	t.regex(
		String((notice as React.ReactElement<{message: string}>).props.message),
		/Queued prompt failed.*Enter to edit/,
	);
});

test('does not drain queued prompts while conversation is incomplete', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: {},
				isConversationComplete: false,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('does not drain queued prompts without a client', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: null,
				toolManager: {},
				isConversationComplete: true,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('does not drain queued prompts without a tool manager', async t => {
	let dispatchAttempts = 0;
	const {unmount} = renderWithTheme(
		<QueuedPromptHarness
			overrides={{
				startChat: true,
				client: {},
				toolManager: null,
				isConversationComplete: true,
				handleUserSubmit: async () => {
					dispatchAttempts++;
				},
			}}
		/>,
	);

	await new Promise(resolve => setTimeout(resolve, 25));
	t.is(dispatchAttempts, 0);
	unmount();
});

test('drains every queued prompt after each dispatched turn returns to idle', async t => {
	const submitted: string[] = [];

	const QueueDrainHarness = () => {
		const userMessageQueue = useUserMessageQueue();
		const [isConversationComplete, setIsConversationComplete] =
			React.useState(true);

		React.useEffect(() => {
			userMessageQueue.enqueueMessage({message: 'first', displayValue: 'first'});
			userMessageQueue.enqueueMessage({message: 'second', displayValue: 'second'});
		}, [userMessageQueue.enqueueMessage]);

		return (
			<InteractiveApp
				{...makeProps({
					startChat: true,
					client: {},
					toolManager: {},
					isConversationComplete,
					handleUserSubmit: async message => {
						submitted.push(message);
						setIsConversationComplete(false);
						await new Promise(resolve => setTimeout(resolve, 10));
						setIsConversationComplete(true);
					},
				})}
				userMessageQueue={userMessageQueue}
			/>
		);
	};

	const {unmount} = renderWithTheme(<QueueDrainHarness />);
	await new Promise(resolve => setTimeout(resolve, 100));
	t.deepEqual(submitted, ['first', 'second']);
	unmount();
});

test('drains a prompt after delayed command completion when the app is idle', async t => {
	const submitted: string[] = [];

	const DelayedCommandHarness = () => {
		const userMessageQueue = useUserMessageQueue();
		const [isToolExecuting, setIsToolExecuting] = React.useState(true);
		const [isConversationComplete, setIsConversationComplete] =
			React.useState(false);

		React.useEffect(() => {
			userMessageQueue.enqueueMessage({
				message: 'after compact',
				displayValue: 'after compact',
			});
			const timeout = setTimeout(() => {
				setIsToolExecuting(false);
				setIsConversationComplete(true);
			}, DELAY_COMMAND_COMPLETE_MS);

			return () => clearTimeout(timeout);
		}, [userMessageQueue.enqueueMessage]);

		return (
			<InteractiveApp
				{...makeProps({
					startChat: true,
					client: {},
					toolManager: {},
					isToolExecuting,
					isConversationComplete,
					handleUserSubmit: async message => {
						submitted.push(message);
					},
				})}
				userMessageQueue={userMessageQueue}
			/>
		);
	};

	const {unmount} = renderWithTheme(<DelayedCommandHarness />);
	await new Promise(resolve =>
		setTimeout(resolve, DELAY_COMMAND_COMPLETE_MS + 40),
	);
	t.deepEqual(submitted, ['after compact']);
	unmount();
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

// InteractiveApp is mounted by App.tsx with no UIStateProvider above it, so it
// has to supply its own. Rendering with the harness's provider hid a crash:
// FileExplorer calls useUIStateContext, which threw and took the CLI down with
// exit 1 when the provider only wrapped ChatInput. Render without it.
test('explorer mode renders without an ambient UIStateProvider', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp {...makeProps({isExplorerMode: true})} />,
		{withUIState: false},
	);
	// Ink renders a thrown error into the frame rather than rethrowing, so
	// assert on the frame — t.notThrows would pass either way.
	const output = stripAnsi(lastFrame() ?? '');
	t.notRegex(output, /must be used within a UIStateProvider/);
	t.true(output.length > 0);
});

test('chat input renders without an ambient UIStateProvider', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp {...makeProps({startChat: true})} />,
		{withUIState: false},
	);
	const output = stripAnsi(lastFrame() ?? '');
	t.notRegex(output, /must be used within a UIStateProvider/);
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

test('Escape does not cancel work while a live component captures input', async t => {
	let cancelled = 0;
	const {stdin} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				isToolExecuting: true,
				liveComponentCapturesInput: true,
				handleCancel: () => {
					cancelled++;
				},
			})}
		/>,
	);

	await pressEscape(stdin);
	t.is(cancelled, 0);
});

test('bash-style live execution keeps the composer mounted', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				startChat: true,
				client: {},
				isToolExecuting: true,
				liveComponentCapturesInput: false,
			})}
		/>,
	);

	// Asserts the composer is on screen via its placeholder. The welcome
	// redesign replaced "/ commands, ! bash, ↑/↓ history" with "Ask
	// anything..." and this assertion was left behind.
	t.regex(stripAnsi(lastFrame() ?? ''), /Ask anything\.\.\./);
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
	let latestChatComponents: React.ReactNode[] = [];
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
		latestChatComponents = chatComponents;
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
	await waitForCondition(() => latestMessages.length === 0);

	t.is(cancelled, 1);
	t.deepEqual(latestMessages, []);
	// In inline mode the bubble is committed to Ink's <Static> scrollback and
	// cannot be un-printed, so the gate in handleRecallSubmittedDraft must
	// skip the chatComponents pop. Asserting on the array length tests the
	// gate directly; asserting against the frame log only proves the bubble
	// was once written, never that it is still present.
	t.is(latestChatComponents.length, 1);
	t.is(latestAbortController, null);
	t.is(latestIsCancelling, false);
});

// The fullscreen (altScreenActive: true) variant of the recall test below
// explicitly exercises the altScreenActive branch of the gated chatComponents
// pop in handleRecallSubmittedDraft. The inline test above exercises the
// altScreenActive: false branch.

test('Escape recall in fullscreen mode pops the bubble from React (altScreenActive branch)', async t => {
	let latestChatComponents: React.ReactNode[] = [];

	const RecallHarness = () => {
		const [isGenerating, setIsGenerating] = React.useState(false);
		const [messages, setMessages] = React.useState<Message[]>([]);
		const [chatComponents, setChatComponents] = React.useState<
			React.ReactNode[]
		>([]);
		const [abortController, setAbortController] =
			React.useState<AbortController | null>(null);

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
					altScreenActive: true,
					handleCancel: () => {
						abortController?.abort();
						setIsGenerating(false);
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

	// Mount effects on alt-screen layouts land on later ticks; settle the
	// initial render before sending keystrokes so ChatInput's useInput is
	// attached and listening.
	await new Promise(r => setTimeout(r, 50));

	stdin.write('fix the typo');
	await waitForCondition(() => /fix the typo/.test(lastFrame() ?? ''), 3000);
	stdin.write('\r');
	await waitForCondition(() => latestChatComponents.length === 1, 3000);

	await pressEscape(stdin);

	// Production code pops the chat component when altScreenActive is true
	// (the bubble lives in React state only, not in Ink's <Static> scrollback,
	// so it can be removed from the viewport). This is the path the inline
	// test above intentionally does NOT exercise — it's the altScreenActive
	// branch of the gated chatComponents pop.
	await waitForCondition(() => latestChatComponents.length === 0, 3000);
	t.is(latestChatComponents.length, 0);
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

test('plan review bar receives the current session artifact path', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				currentSessionId: '11111111-1111-4111-8111-111111111111',
				planReviewState: {show: true, originalMessage: 'make a plan'},
			})}
		/>,
	);

	t.regex(lastFrame()!, /implementation_plan\.md/);
});

test('plan review bar tolerates an invalid external session ID', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp
			{...makeProps({
				currentSessionId: '../outside',
				planReviewState: {show: true, originalMessage: 'make a plan'},
			})}
		/>,
	);

	t.regex(lastFrame()!, /Plan ready/);
	t.notRegex(lastFrame()!, /implementation_plan\.md/);
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
				pendingPlanProceed:
					'The persisted plan is approved. Proceed with implementing it.',
				developmentMode: 'normal',
				setPendingPlanProceed: v => {
					if (v === null) pendingReset = true;
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
				pendingPlanProceed:
					'The persisted plan is approved. Proceed with implementing it.',
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
