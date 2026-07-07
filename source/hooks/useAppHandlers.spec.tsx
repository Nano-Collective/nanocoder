import test from 'ava';
import { cleanup, render } from 'ink-testing-library';
import React from 'react';
import type { CheckpointListItem } from '@/types/checkpoint';
import type { AIProviderConfig } from '@/types/config';
import type { DevelopmentMode, LLMClient, Message } from '@/types/core';
import type { CustomCommand } from '@/types/commands';
import type { AppHandlers } from './useAppHandlers';
import { useAppHandlers } from './useAppHandlers';

import {
	getKeyGeneratorSessionId,
	setKeyGeneratorSessionId,
} from '@/session/key-generator';

console.log('\nuseAppHandlers.spec.tsx');

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

interface ProbeOverrides {
	abortController?: AbortController | null;
	developmentMode?: DevelopmentMode;
	client?: LLMClient | null;
	messages?: Message[];
}

let captured: AppHandlers | null = null;

function makeProps(overrides: ProbeOverrides) {
	const updateMessages = spy<[Message[]]>();
	const setIsCancelling = spy<[boolean]>();
	const setDevelopmentMode = spy<
		[DevelopmentMode | ((prev: DevelopmentMode) => DevelopmentMode)]
	>();
	const setIsConversationComplete = spy<[boolean]>();
	const setIsToolExecuting = spy<[boolean]>();
	const setActiveMode = spy<[unknown]>();
	const setCheckpointLoadData = spy<
		[
			| {
				checkpoints: CheckpointListItem[];
				currentMessageCount: number;
			}
			| null,
		]
	>();
	const setShowAllSessions = spy<[boolean]>();
	const setCurrentSessionId = spy<[string | null]>();
	const setSessionName = spy<[string]>();
	const setCurrentProvider = spy<[string]>();
	const setCurrentModel = spy<[string]>();
	const setLiveTaskList = spy<[unknown]>();
	const addToChatQueue = spy<[React.ReactNode]>();
	const setChatComponents = spy<[React.ReactNode[]]>();
	const setLiveComponent = spy<[React.ReactNode]>();
	const enterModelSelectionMode = spy<[]>();
	const enterModelDatabaseMode = spy<[]>();
	const enterConfigWizardMode = spy<[]>();
	const enterSettingsMode = spy<[]>();
	const enterMcpWizardMode = spy<[]>();
	const enterExplorerMode = spy<[]>();
	const enterIdeSelectionMode = spy<[]>();
	const enterTune = spy<[]>();
	const enterSchedulerMode = spy<[]>();
	const handleChatMessage = spy<[string]>();
	const dismissActiveEditor = spy<[]>();
	const handleModelSelect = spy<[string, string, boolean?]>();

	const baseProps = {
		messages: overrides.messages ?? [],
		currentProvider: 'openai-compatible',
		currentProviderConfig: null as AIProviderConfig | null,
		currentModel: 'mock-model',
		currentTheme: 'default' as never,
		abortController: overrides.abortController ?? null,
		updateInfo: null,
		mcpServersStatus: [],
		lspServersStatus: [],
		preferencesLoaded: true,
		customCommandsCount: 0,
		customCommandCache: new Map<string, CustomCommand>(),
		customCommandLoader: null,
		customCommandExecutor: null,
		updateMessages,
		setIsCancelling,
		setDevelopmentMode,
		setIsConversationComplete,
		setIsToolExecuting,
		setActiveMode,
		setCheckpointLoadData,
		setShowAllSessions,
		setCurrentSessionId,
		setSessionName,
		setCurrentProvider,
		setCurrentModel,
		setLiveTaskList,
		addToChatQueue,
		setChatComponents,
		setLiveComponent,
		client: overrides.client ?? null,
		getMessageTokens: () => 0,
		enterModelSelectionMode,
		enterModelDatabaseMode,
		enterConfigWizardMode,
		enterSettingsMode,
		enterMcpWizardMode,
		enterExplorerMode,
		enterIdeSelectionMode,
		enterTune,
		enterSchedulerMode,
		handleChatMessage: async (m: string) => {
			handleChatMessage(m);
		},
		dismissActiveEditor: () => dismissActiveEditor(),
		developmentMode: overrides.developmentMode ?? 'normal',
		handleModelSelect: async (provider: string, model: string, isProgrammatic?: boolean) => {
			handleModelSelect(provider, model, isProgrammatic);
		},
	};

	return {
		props: baseProps,
		spies: {
			updateMessages,
			setIsCancelling,
			setDevelopmentMode,
			setIsConversationComplete,
			setIsToolExecuting,
			setActiveMode,
			setCheckpointLoadData,
			setShowAllSessions,
			setCurrentSessionId,
			setChatComponents,
			addToChatQueue,
			dismissActiveEditor,
			handleModelSelect,
		},
	};
}

function setup(overrides: ProbeOverrides = {}) {
	captured = null;
	const { props, spies } = makeProps(overrides);

	function Probe() {
		captured = useAppHandlers(props as never);
		return null;
	}

	const instance = render(<Probe />);
	if (!captured) throw new Error('useAppHandlers did not initialize');
	return { handlers: captured as AppHandlers, instance, spies };
}

test.afterEach(() => {
	cleanup();
	captured = null;
});

test('returns the expected handler surface', t => {
	const { handlers } = setup();

	t.is(typeof handlers.clearMessages, 'function');
	t.is(typeof handlers.handleCancel, 'function');
	t.is(typeof handlers.handleToggleDevelopmentMode, 'function');
	t.is(typeof handlers.handleShowStatus, 'function');
	t.is(typeof handlers.handleCheckpointSelect, 'function');
	t.is(typeof handlers.handleCheckpointCancel, 'function');
	t.is(typeof handlers.enterSessionSelectorMode, 'function');
	t.is(typeof handlers.handleSessionSelect, 'function');
	t.is(typeof handlers.handleSessionCancel, 'function');
	t.is(typeof handlers.enterCheckpointLoadMode, 'function');
	t.is(typeof handlers.handleMessageSubmit, 'function');
});

test('handleCancel without an abort controller is a no-op', t => {
	const { handlers, spies } = setup({ abortController: null });

	handlers.handleCancel();

	t.is(spies.setIsCancelling.calls.length, 0);
});

test('handleCancel aborts the controller and sets cancelling=true', t => {
	const controller = new AbortController();
	const { handlers, spies } = setup({ abortController: controller });

	handlers.handleCancel();

	t.deepEqual(spies.setIsCancelling.calls, [[true]]);
	t.true(controller.signal.aborted);
});

test('handleToggleDevelopmentMode cycles through modes', t => {
	const { handlers, spies } = setup({ developmentMode: 'normal' });
	handlers.handleToggleDevelopmentMode();
	t.deepEqual(spies.setDevelopmentMode.calls, [['auto-accept']]);

	const { handlers: h2, spies: s2 } = setup({ developmentMode: 'auto-accept' });
	h2.handleToggleDevelopmentMode();
	t.deepEqual(s2.setDevelopmentMode.calls, [['yolo']]);

	const { handlers: h3, spies: s3 } = setup({ developmentMode: 'yolo' });
	h3.handleToggleDevelopmentMode();
	t.deepEqual(s3.setDevelopmentMode.calls, [['plan']]);

	const { handlers: h4, spies: s4 } = setup({ developmentMode: 'plan' });
	h4.handleToggleDevelopmentMode();
	t.deepEqual(s4.setDevelopmentMode.calls, [['normal']]);
});

test('handleToggleDevelopmentMode calls handleModelSelect on mode switch', async t => {
	const { handlers, spies } = setup({ developmentMode: 'normal' });

	handlers.handleToggleDevelopmentMode();

	// Wait a tick for the async void function to run
	await new Promise(resolve => setTimeout(resolve, 0));

	t.is(spies.handleModelSelect.calls.length, 1);
	// We expect the third argument (isProgrammatic) to be true
	t.is(spies.handleModelSelect.calls[0]![2], true);
});

test('handleToggleDevelopmentMode preserves headless mode', t => {
	// Headless is entered by the daemon for triggered runs, not by the user.
	// Shift+Tab cycles only through user-facing modes; if `developmentMode`
	// is somehow `headless` when toggle fires, it should stay there.
	const { handlers, spies } = setup({ developmentMode: 'headless' });

	handlers.handleToggleDevelopmentMode();
	t.is(spies.setDevelopmentMode.calls.length, 0);
});

test('handleCheckpointCancel clears active mode and checkpoint data', t => {
	const { handlers, spies } = setup();

	handlers.handleCheckpointCancel();

	t.deepEqual(spies.setActiveMode.calls, [[null]]);
	t.deepEqual(spies.setCheckpointLoadData.calls, [[null]]);
});

test('handleSessionCancel clears active mode', t => {
	const { handlers, spies } = setup();

	handlers.handleSessionCancel();

	t.deepEqual(spies.setActiveMode.calls, [[null]]);
});

test('enterCheckpointLoadMode sets data then activates the mode', t => {
	const { handlers, spies } = setup();

	const checkpoints = [
		{ name: 'cp1', timestamp: 0, messageCount: 0 } as unknown as CheckpointListItem,
	];

	handlers.enterCheckpointLoadMode(checkpoints, 5);

	t.is(spies.setCheckpointLoadData.calls.length, 1);
	t.deepEqual(spies.setCheckpointLoadData.calls[0]![0], {
		checkpoints,
		currentMessageCount: 5,
	});
	t.deepEqual(spies.setActiveMode.calls, [['checkpointLoad']]);
});

test('enterSessionSelectorMode defaults showAll to false', t => {
	const { handlers, spies } = setup();

	handlers.enterSessionSelectorMode();

	t.deepEqual(spies.setShowAllSessions.calls, [[false]]);
	t.deepEqual(spies.setActiveMode.calls, [['sessionSelector']]);
});

test('enterSessionSelectorMode forwards showAll=true when requested', t => {
	const { handlers, spies } = setup();

	handlers.enterSessionSelectorMode(true);

	t.deepEqual(spies.setShowAllSessions.calls, [[true]]);
	t.deepEqual(spies.setActiveMode.calls, [['sessionSelector']]);
});

test('clearMessages resets key generator session ID', async t => {
	const { handlers } = setup({
		messages: [{ role: 'user', content: 'test' }],
	});

	setKeyGeneratorSessionId('old-session-id-prefix');
	t.is(getKeyGeneratorSessionId(), 'old-session-id-prefix');

	await handlers.clearMessages();

	const newId = getKeyGeneratorSessionId();
	t.not(newId, 'old-session-id-prefix');
	t.regex(newId, /^[0-9a-f]{8}$/);
});
