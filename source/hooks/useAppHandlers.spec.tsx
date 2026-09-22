import test from 'ava';
import {cleanup, render} from 'ink-testing-library';
import React from 'react';
import type {CheckpointListItem} from '@/types/checkpoint';
import type {AIProviderConfig} from '@/types/config';
import type {DevelopmentMode, LLMClient, Message} from '@/types/core';
import type {CustomCommand} from '@/types/commands';
import type {AppHandlers} from './useAppHandlers';
import {useAppHandlers} from './useAppHandlers';
import {mkdtempSync, rmSync} from 'fs';
import * as fs from 'fs/promises';
import {tmpdir} from 'os';
import {join} from 'path';
import {CheckpointManager} from '@/services/checkpoint-manager';
import {
        resetSessionCwd,
        setProjectRoot,
        setSessionCwd,
} from '@/services/session-cwd';


import {
	getKeyGeneratorSessionId,
	setKeyGeneratorSessionId,
} from '@/session/key-generator';
import {clearAppConfig} from '@/config/index';
import {
	addPendingHookContext,
	clearPendingHookContext,
	drainPendingHookContext,
} from '@/services/lifecycle-hooks';
import {resetPreferencesCache} from '@/config/preferences';

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
	architectReviewState?: {
		show: boolean;
		checkpointName: string;
		filesChanged: string[];
		filesMissing: string[];
	} | null;
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
	const setPlanReviewState = spy<
	    [{show: boolean; originalMessage: string} | null]
	>();
	const setArchitectReviewState = spy<
		[
			{
				show: boolean;
				checkpointName: string;
				filesChanged: string[];
				filesMissing: string[];
			} | null,
		]
	>();
	const addToChatQueue = spy<[React.ReactNode]>();
	const setChatComponents = spy<[React.ReactNode[]]>();
	const setLiveComponent = spy<[React.ReactNode]>();
	const setLiveComponentCapturesInput = spy<[boolean]>();
	const enterModelSelectionMode = spy<[]>();
	const enterModelDatabaseMode = spy<[]>();
	const enterSettingsMode = spy<[]>();
	const enterExplorerMode = spy<[]>();
	const enterIdeSelectionMode = spy<[]>();
	const enterTune = spy<[]>();
	const enterSchedulerMode = spy<[]>();
	const handleChatMessage = spy<[string, (string | undefined)?]>();
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
		currentSessionId: '11111111-1111-4111-8111-111111111111',
		ensureCurrentSessionId: () =>
			'11111111-1111-4111-8111-111111111111',
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
		setPlanReviewState,
		setArchitectReviewState,
		addToChatQueue,
		setChatComponents,
		setLiveComponent,
		setLiveComponentCapturesInput,
		client: overrides.client ?? null,
		getMessageTokens: () => 0,
		enterModelSelectionMode,
		enterModelDatabaseMode,
		enterSettingsMode,
		enterExplorerMode,
		enterIdeSelectionMode,
		enterTune,
		enterSchedulerMode,
		handleChatMessage: async (m: string, displayValue?: string) => {
			// Both args: the second is what the transcript shows the user, and
			// architect's revise path deliberately differs from the first.
			handleChatMessage(m, displayValue);
		},
		dismissActiveEditor: () => dismissActiveEditor(),
		developmentMode: overrides.developmentMode ?? 'normal',
		architectReviewState: overrides.architectReviewState ?? null,
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
			setPlanReviewState,
			dismissActiveEditor,
			handleModelSelect,
			handleChatMessage,
			setArchitectReviewState,
		},
	};
}

function setup(overrides: ProbeOverrides = {}) {
	captured = null;
	const {props, spies} = makeProps(overrides);

	function Probe() {
		captured = useAppHandlers(props as never);
		return null;
	}

	const instance = render(<Probe />);
	if (!captured) throw new Error('useAppHandlers did not initialize');
	return {handlers: captured as AppHandlers, instance, spies};
}

test.afterEach(() => {
	cleanup();
	captured = null;
});

test('returns the expected handler surface', t => {
	const {handlers} = setup();

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

test('signals slash-command completion so queued work can resume', async t => {
	const {handlers, spies} = setup();

	await handlers.handleMessageSubmit('/compact');

	t.deepEqual(spies.setIsConversationComplete.calls, [[false], [true]]);
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
	t.deepEqual(s4.setDevelopmentMode.calls, [['architect']]);
});

test.serial('handleArchitectRevert restores checkpoint files', async t => {
        const tempDir = mkdtempSync(
                join(tmpdir(), 'nanocoder-architect-revert-test-'),
        );

        const originalContent = 'original content';
        const changedContent = 'changed content';

        try {
                setProjectRoot(tempDir);
                setSessionCwd(tempDir);

                const filePath = join(tempDir, 'test.txt');

                await fs.writeFile(filePath, originalContent, 'utf-8');

                const manager = new CheckpointManager(tempDir);

                const metadata = await manager.saveCheckpoint(
                        'architect-revert-test',
                        [],
                        'TestProvider',
                        'test-model',
                        ['test.txt'],
                );

                await fs.writeFile(filePath, changedContent, 'utf-8');

                const {handlers, spies} = setup({
                        architectReviewState: {
                                show: true,
                                checkpointName: metadata.name,
                                filesChanged: ['test.txt'],
                                filesMissing: [],
                        },
                });

                await handlers.handleArchitectRevert();

                t.is(
                        await fs.readFile(filePath, 'utf-8'),
                        originalContent,
                );
                t.deepEqual(spies.setArchitectReviewState.calls, [[null]]);
        } finally {
                resetSessionCwd();
                rmSync(tempDir, {recursive: true, force: true});
        }
});

test.serial(
        'handleArchitectRevertAndRevise restores files and sends revision instructions',
        async t => {
                const tempDir = mkdtempSync(
                        join(tmpdir(), 'nanocoder-architect-revise-test-'),
                );

                const originalContent = 'original content';
                const changedContent = 'changed content';

                try {
                        setProjectRoot(tempDir);
                        setSessionCwd(tempDir);

                        const filePath = join(tempDir, 'test.txt');

                        await fs.writeFile(filePath, originalContent, 'utf-8');

                        const manager = new CheckpointManager(tempDir);

                        const metadata = await manager.saveCheckpoint(
                                'architect-revise-test',
                                [],
                                'TestProvider',
                                'test-model',
                                ['test.txt'],
                        );

                        await fs.writeFile(filePath, changedContent, 'utf-8');

                        const {handlers, spies} = setup({
                                architectReviewState: {
                                        show: true,
                                        checkpointName: metadata.name,
                                        filesChanged: ['test.txt'],
                                        filesMissing: [],
                                },
                        });

                        const instructions =
                                'Please simplify the implementation.';

                        await handlers.handleArchitectRevertAndRevise(
                                instructions,
                        );

                        t.is(
                                await fs.readFile(filePath, 'utf-8'),
                                originalContent,
                        );
                        t.deepEqual(
                                spies.setArchitectReviewState.calls,
                                [[null]],
                        );
                        // Dismissing the gate opens a render where nothing is
                        // generating and the turn still reads complete. The revise
                        // turn goes through handleChatMessage, which never resets
                        // the flag, so without this a queued prompt drains into
                        // the gap and runs underneath the revision turn.
                        t.deepEqual(
                                spies.setIsConversationComplete.calls,
                                [[false]],
                        );
                        t.deepEqual(spies.handleChatMessage.calls, [
                                [
                                        // The prompt must say the changes are gone. The old wording
					// told the model to "review the changes you just made"
					// straight after deleting them, pointing it at a disk
					// state that no longer existed.
					`Your previous changes were reverted and are no longer on disk. Re-read any file before editing it, then redo the work with these instructions:\n\n${instructions}`,
					instructions,
                                ],
                        ]);
                } finally {
                        resetSessionCwd();
                        rmSync(tempDir, {recursive: true, force: true});
                }
        },
);
test('declining execution keeps Plan Mode active and asks for revisions', t => {
	const {handlers, spies} = setup({developmentMode: 'plan'});

	handlers.handlePlanModify();

	t.deepEqual(spies.setIsConversationComplete.calls, [[false]]);
	t.deepEqual(spies.setPlanReviewState.calls, [[null]]);
	t.deepEqual(spies.setDevelopmentMode.calls, []);
	const notice = spies.addToChatQueue.calls.at(-1)?.[0];
	t.true(
		React.isValidElement(notice) &&
			String((notice.props as {message?: string}).message).includes(
				'Plan Mode remains active',
			),
	);
	t.true(
		React.isValidElement(notice) &&
			String((notice.props as {message?: string}).message).includes(
				'what to change',
			),
	);
});

test('asking for clarification blocks queued prompts until the turn starts', async t => {
	const {handlers, spies} = setup({developmentMode: 'plan'});

	await handlers.handlePlanAskMore();

	t.deepEqual(spies.setIsConversationComplete.calls, [[false]]);
	t.deepEqual(spies.setPlanReviewState.calls, [[null]]);
	t.deepEqual(spies.handleChatMessage.calls, [
		[
			'please ask me any additional clarifying questions before proceeding',
			undefined,
		],
	]);
});

async function withMockConfig(
	config: any,
	preferences: any,
	fn: () => Promise<void>
) {
	const {tmpdir} = await import('os');
	const {join} = await import('path');
	const {mkdirSync, writeFileSync, rmSync} = await import('fs');
	
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	const originalCwd = process.cwd();
	const testDir = join(tmpdir(), `nanocoder-apphandlers-test-${Date.now()}-${Math.random()}`);
	mkdirSync(testDir, {recursive: true});

	try {
		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(config));
		writeFileSync(join(testDir, 'nanocoder-preferences.json'), JSON.stringify(preferences));
		process.env.NANOCODER_CONFIG_DIR = testDir;
		process.chdir(testDir);
		clearAppConfig();
		resetPreferencesCache();
		
		await fn();
	} finally {
		if (originalConfigDir) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
		process.chdir(originalCwd);
		clearAppConfig();
		resetPreferencesCache();
		rmSync(testDir, {recursive: true, force: true});
	}
}

test.serial('handleToggleDevelopmentMode calls handleModelSelect using modeProviders if configured', async t => {
	const config = {
		nanocoder: {
			providers: [
				{name: 'test-provider', models: ['model-1']}
			],
			modeProviders: {
				'auto-accept': {provider: 'test-provider', model: 'model-1'}
			}
		}
	};
	
	await withMockConfig(config, {}, async () => {
		const {handlers, spies} = setup({developmentMode: 'normal'});
		handlers.handleToggleDevelopmentMode();
		
		// Wait a tick for the async void function to run
		await new Promise(resolve => setTimeout(resolve, 0));
		
		t.is(spies.handleModelSelect.calls.length, 1);
		t.is(spies.handleModelSelect.calls[0]![0], 'test-provider');
		t.is(spies.handleModelSelect.calls[0]![1], 'model-1');
		t.is(spies.handleModelSelect.calls[0]![2], true);
	});
});

test.serial('handleToggleDevelopmentMode uses fallback if modeProviders is not configured', async t => {
	const config = {
		nanocoder: {
			providers: [
				{name: 'fallback-provider', models: ['fallback-model']}
			]
		}
	};
	
	const prefs = {
		lastProvider: 'fallback-provider',
		lastModel: 'fallback-model',
	};
	
	await withMockConfig(config, prefs, async () => {
		const {handlers, spies} = setup({developmentMode: 'normal'});
		handlers.handleToggleDevelopmentMode();
		
		// Wait a tick for the async void function to run
		await new Promise(resolve => setTimeout(resolve, 0));
		
		t.is(spies.handleModelSelect.calls.length, 1);
		t.is(spies.handleModelSelect.calls[0]![0], 'fallback-provider');
		t.is(spies.handleModelSelect.calls[0]![1], 'fallback-model');
		t.is(spies.handleModelSelect.calls[0]![2], true);
	});
});

test.serial('handleToggleDevelopmentMode does not toast when landing on normal', async t => {
	const config = {
		nanocoder: {
			providers: [{name: 'test-provider', models: ['model-1']}],
			modeProviders: {
				normal: {provider: 'test-provider', model: 'model-1'}
			}
		}
	};

	await withMockConfig(config, {}, async () => {
		// plan → normal: normal has a model override, but restoring the user's
		// own default model is not news — the status bar flip is the feedback.
		const {handlers, spies} = setup({developmentMode: 'plan'});
		handlers.handleToggleDevelopmentMode();
		await new Promise(resolve => setTimeout(resolve, 0));

		t.is(spies.addToChatQueue.calls.length, 0);
		t.is(spies.handleModelSelect.calls.length, 1);
	});
});

test.serial('handleToggleDevelopmentMode suppresses identical repeated model toasts', async t => {
	const config = {
		nanocoder: {
			providers: [{name: 'test-provider', models: ['model-1']}],
			modeProviders: {
				'auto-accept': {provider: 'test-provider', model: 'model-1'}
			}
		}
	};

	await withMockConfig(config, {}, async () => {
		const {handlers, spies} = setup({developmentMode: 'normal'});
		// Rapid Shift+Tab presses all re-enter auto-accept before props update;
		// the identical "[auto-accept mode → model-1]" toast must queue once.
		for (let i = 0; i < 3; i++) {
			handlers.handleToggleDevelopmentMode();
			await new Promise(resolve => setTimeout(resolve, 0));
		}

		t.is(spies.addToChatQueue.calls.length, 1);
	});
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

// ---------------------------------------------------------------------------
// Lifecycle hooks at the prompt boundary.
//
// The gate and the context injection live here rather than in
// handleMessageSubmission, so this is the only place the "which inputs are
// local actions?" question is answered. Getting it wrong silently reroutes a
// local command to the model, so it is pinned.
// ---------------------------------------------------------------------------

test.serial(
	'a pending hook context does not swallow a ! bash command',
	async t => {
		clearPendingHookContext();
		addPendingHookContext('branch: main');
		const {handlers, spies} = setup();

		await handlers.handleMessageSubmit('!echo hooktest');

		// The regression: prefixing <hook-context> onto the message defeats
		// parseInput's leading-`!` check, so the bash command is sent to the
		// model as chat instead of running locally.
		t.is(
			spies.handleChatMessage.calls.length,
			0,
			'a ! command must never reach the model',
		);
		t.is(
			drainPendingHookContext(),
			'branch: main',
			'and the buffered context must survive for the next real prompt',
		);
	},
);

test.serial(
	'a pending hook context does not swallow a leading-whitespace ! command',
	async t => {
		clearPendingHookContext();
		addPendingHookContext('branch: main');
		const {handlers, spies} = setup();

		// parseInput trims before testing for `!`, so the local-action check
		// has to trim too or this one slips through as chat.
		await handlers.handleMessageSubmit('  !echo hooktest');

		t.is(spies.handleChatMessage.calls.length, 0);
		t.is(drainPendingHookContext(), 'branch: main');
	},
);

test.serial('a pending hook context does not swallow a slash command', async t => {
	clearPendingHookContext();
	addPendingHookContext('branch: main');
	const {handlers, spies} = setup();

	await handlers.handleMessageSubmit('/help');

	t.is(spies.handleChatMessage.calls.length, 0);
	t.is(drainPendingHookContext(), 'branch: main');
});

test.serial(
	'a pending hook context does not swallow a leading-whitespace slash command',
	async t => {
		clearPendingHookContext();
		addPendingHookContext('branch: main');
		const {handlers, spies} = setup();

		// Same trap as the `!` case: parseInput trims before testing for `/`, so
		// an untrimmed local-action check prefixes this one and sends `/help` to
		// the model as chat.
		await handlers.handleMessageSubmit('  /help');

		t.is(spies.handleChatMessage.calls.length, 0);
		t.is(drainPendingHookContext(), 'branch: main');
	},
);

test.serial('a chat prompt does receive the buffered hook context', async t => {
	clearPendingHookContext();
	addPendingHookContext('branch: main');
	const {handlers, spies} = setup();

	await handlers.handleMessageSubmit('what changed?');

	t.is(spies.handleChatMessage.calls.length, 1);
	const sent = spies.handleChatMessage.calls[0]![0];
	t.true(
		sent.startsWith('<hook-context>\nbranch: main\n</hook-context>\n\n'),
		`context should be prepended, got: ${sent}`,
	);
	t.true(sent.endsWith('what changed?'));
	t.is(drainPendingHookContext(), '', 'and draining is destructive');
});

test.serial('a prompt with no pending context is passed through intact', async t => {
	clearPendingHookContext();
	const {handlers, spies} = setup();

	await handlers.handleMessageSubmit('what changed?');

	t.is(spies.handleChatMessage.calls.length, 1);
	t.is(spies.handleChatMessage.calls[0]![0], 'what changed?');
});

// Architect takes a checkpoint per turn. Every exit from the gate has to
// release it, or /checkpoint list fills with machine-named entries carrying a
// full file-and-conversation snapshot each.
test.serial('handleArchitectKeep releases the turn checkpoint', async t => {
	const tempDir = mkdtempSync(join(tmpdir(), 'nanocoder-architect-keep-'));

	try {
		setProjectRoot(tempDir);
		setSessionCwd(tempDir);

		await fs.writeFile(join(tempDir, 'test.txt'), 'original', 'utf-8');

		const manager = new CheckpointManager(tempDir);
		const metadata = await manager.saveCheckpoint(
			'architect-keep-test',
			[],
			'TestProvider',
			'test-model',
			['test.txt'],
		);

		t.true((await manager.listCheckpoints()).some(c => c.name === metadata.name));

		const {handlers, spies} = setup({
			architectReviewState: {
				show: true,
				checkpointName: metadata.name,
				filesChanged: ['test.txt'],
				filesMissing: [],
			},
		});

		await handlers.handleArchitectKeep();

		t.deepEqual(spies.setArchitectReviewState.calls, [[null]]);
		t.is(
			await fs.readFile(join(tempDir, 'test.txt'), 'utf-8'),
			'original',
			'keep must not touch the files',
		);
		t.false(
			(await manager.listCheckpoints()).some(c => c.name === metadata.name),
			'keep must release the checkpoint',
		);
	} finally {
		resetSessionCwd();
		rmSync(tempDir, {recursive: true, force: true});
	}
});

test.serial('handleArchitectRevert releases the turn checkpoint', async t => {
	const tempDir = mkdtempSync(join(tmpdir(), 'nanocoder-architect-rel-'));

	try {
		setProjectRoot(tempDir);
		setSessionCwd(tempDir);

		await fs.writeFile(join(tempDir, 'test.txt'), 'original', 'utf-8');

		const manager = new CheckpointManager(tempDir);
		const metadata = await manager.saveCheckpoint(
			'architect-release-test',
			[],
			'TestProvider',
			'test-model',
			['test.txt'],
		);

		await fs.writeFile(join(tempDir, 'test.txt'), 'changed', 'utf-8');

		const {handlers} = setup({
			architectReviewState: {
				show: true,
				checkpointName: metadata.name,
				filesChanged: ['test.txt'],
				filesMissing: [],
			},
		});

		await handlers.handleArchitectRevert();

		t.is(await fs.readFile(join(tempDir, 'test.txt'), 'utf-8'), 'original');
		t.false(
			(await manager.listCheckpoints()).some(c => c.name === metadata.name),
			'revert must release the checkpoint',
		);
	} finally {
		resetSessionCwd();
		rmSync(tempDir, {recursive: true, force: true});
	}
});

// Without this the conversation still claims every write succeeded while the
// files have moved back underneath it, and the model's next string_replace
// matches old_str against a state that no longer exists.
test.serial('handleArchitectRevert tells the model the changes are gone', async t => {
	const tempDir = mkdtempSync(join(tmpdir(), 'nanocoder-architect-notice-'));

	try {
		setProjectRoot(tempDir);
		setSessionCwd(tempDir);

		await fs.writeFile(join(tempDir, 'test.txt'), 'original', 'utf-8');

		const manager = new CheckpointManager(tempDir);
		const metadata = await manager.saveCheckpoint(
			'architect-notice-test',
			[],
			'TestProvider',
			'test-model',
			['test.txt'],
		);

		await fs.writeFile(join(tempDir, 'test.txt'), 'changed', 'utf-8');

		const priorMessages: Message[] = [
			{role: 'user', content: 'edit the file'},
			{role: 'assistant', content: 'done'},
		];

		const {handlers, spies} = setup({
			messages: priorMessages,
			architectReviewState: {
				show: true,
				checkpointName: metadata.name,
				filesChanged: ['test.txt'],
				filesMissing: [],
			},
		});

		await handlers.handleArchitectRevert();

		t.is(spies.updateMessages.calls.length, 1);
		const appended = spies.updateMessages.calls[0][0];
		t.is(appended.length, priorMessages.length + 1, 'appends, never replaces');

		const notice = appended[appended.length - 1];
		t.is(notice.role, 'user');
		t.true(notice.content.includes('reverted'));
		t.true(
			notice.content.includes('test.txt'),
			'names the files so the model knows what moved',
		);
	} finally {
		resetSessionCwd();
		rmSync(tempDir, {recursive: true, force: true});
	}
});
