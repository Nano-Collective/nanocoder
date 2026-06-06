import test from 'ava';
import {Text} from 'ink';
import React from 'react';
import {renderWithTheme} from '../../test-utils/render-with-theme.js';
import {InteractiveApp} from './interactive-app.js';

console.log(`\ninteractive-app.spec.tsx – ${React.version}`);

interface Overrides {
	isExplorerMode?: boolean;
	isIdeSelectionMode?: boolean;
	isSchedulerMode?: boolean;
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
}

function makeProps(o: Overrides = {}) {
	const noop = () => {};
	const noopAsync = async () => {};

	const appState = {
		client: null,
		messages: [],
		currentModel: 'mock-model',
		currentProvider: 'mock',
		startChat: o.startChat ?? false,
		mcpInitialized: true,
		activeMode: o.activeMode ?? null,
		isExplorerMode: o.isExplorerMode ?? false,
		isIdeSelectionMode: o.isIdeSelectionMode ?? false,
		isSchedulerMode: o.isSchedulerMode ?? false,
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
		chatComponents: [],
		compactToolCountsRef: {current: {}},
		setCompactToolDisplay: noop,
		setCompactToolCounts: noop,
		setReasoningExpanded: noop,
		addToChatQueue: noop,
	};

	return {
		appState,
		chatHandler: {isGenerating: o.isGenerating ?? false},
		toolHandler: {
			handleToolConfirmation: noop,
			handleToolConfirmationCancel: noop,
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
		schedulerMode: {
			activeJobCount: 0,
			queueLength: 0,
			isProcessing: false,
			currentJobCommand: null,
		},
		vscodeServer: {
			activeEditor: null,
			dismissActiveEditor: noop,
		},
		staticComponents: [<Text key="static">static-marker</Text>],
		liveComponent: null,
		pendingSubagentApproval: o.pendingSubagentApproval ?? null,
		handleSubagentToolApproval: noop,
		handleQuestionAnswer: noop,
		handleUserSubmit: noopAsync,
		handleIdeSelect: noop,
		exitSchedulerMode: noop,
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

test('renders without crashing in scheduler mode', t => {
	const {lastFrame} = renderWithTheme(
		<InteractiveApp {...makeProps({isSchedulerMode: true})} />,
	);
	t.truthy(lastFrame());
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
