import test from 'ava';
import React from 'react';
import {handleContextMaxCommand} from './context-max-handler.js';
import type {MessageSubmissionOptions} from '@/types';

function createOptions(overrides: Partial<MessageSubmissionOptions> = {}): MessageSubmissionOptions {
	let key = 0;
	return {
		customCommandCache: new Map(),
		customCommandLoader: null,
		customCommandExecutor: null,
		onClearMessages: async () => {},
		onEnterModelSelectionMode: () => {},
		onEnterProviderSelectionMode: () => {},
		onEnterModelDatabaseMode: () => {},
		onEnterConfigWizardMode: () => {},
		onEnterSettingsMode: () => {},
		onEnterMcpWizardMode: () => {},
		onEnterExplorerMode: () => {},
		onEnterIdeSelectionMode: () => {},
		onEnterTune: () => {},
		onEnterCheckpointLoadMode: () => {},
		onShowStatus: () => {},
		onHandleChatMessage: async () => {},
		onAddToChatQueue: () => {},
		setLiveComponent: () => {},
		setIsToolExecuting: () => {},
		getNextComponentKey: () => ++key,
		setMessages: () => {},
		messages: [],
		provider: 'Test Provider',
		providerConfig: null,
		model: 'custom-model',
		theme: 'dark',
		updateInfo: null,
		getMessageTokens: () => 0,
		...overrides,
	};
}

function getMessageText(node: React.ReactNode): string {
	if (!React.isValidElement(node)) return '';
	return String((node.props as {message?: string}).message ?? '');
}

test('handleContextMaxCommand shows provider model config source when resolved', async t => {
	let queued: React.ReactNode = null;
	const handled = await handleContextMaxCommand(['context-max'], createOptions({
		onAddToChatQueue: node => {
			queued = node;
		},
	}));

	t.true(handled);
	t.true(getMessageText(queued).includes('Context limit:'));
});

test('handleContextMaxCommand shows unknown when no context is resolved', async t => {
	let queued: React.ReactNode = null;
	const handled = await handleContextMaxCommand(['context-max'], createOptions({
		provider: 'unknown-provider',
		model: 'unknown-model-that-does-not-exist',
		onAddToChatQueue: node => {
			queued = node;
		},
	}));

	t.true(handled);
	t.true(getMessageText(queued).includes('Context limit:'));
});

test('handleContextMaxCommand uses provider config for context resolution', async t => {
	let queued: React.ReactNode = null;
	const handled = await handleContextMaxCommand(['context-max'], createOptions({
		provider: 'Test Provider',
		model: 'custom-model',
		providerConfig: {
			name: 'Test Provider',
			type: 'openai',
			models: ['custom-model'],
			contextWindows: {
				'custom-model': 65536,
			},
			config: {},
		},
		onAddToChatQueue: node => {
			queued = node;
		},
	}));

	t.true(handled);
	const message = getMessageText(queued);
	t.true(message.includes('65,536'));
	t.true(message.includes('provider model config'));
});
