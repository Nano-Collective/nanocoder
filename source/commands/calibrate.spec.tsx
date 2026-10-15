import {mkdirSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import React from 'react';
import {
	getCalibrationProfile,
	saveCalibrationProfile,
} from '@/calibration/calibration-store';
import {resetPreferencesCache} from '@/config/preferences';
import type {
	AIProviderConfig,
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
	StreamCallbacks,
} from '@/types/index';
import {calibrateCommand} from './calibrate';

let testConfigDir: string;

test.beforeEach(() => {
	testConfigDir = join(
		tmpdir(),
		`nanocoder-calib-cmd-${Date.now()}-${Math.random().toString(36).slice(2)}`,
	);
	mkdirSync(testConfigDir, {recursive: true});
	process.env.NANOCODER_CONFIG_DIR = testConfigDir;
	resetPreferencesCache();
});

test.afterEach(() => {
	try {
		rmSync(testConfigDir, {recursive: true, force: true});
	} catch {
		// Ignore
	}
	delete process.env.NANOCODER_CONFIG_DIR;
	resetPreferencesCache();
});

function createMockLLMClient(): LLMClient {
	return {
		getCurrentModel: () => 'my-model',
		setModel: () => {},
		getContextSize: () => 16384,
		getAvailableModels: async () => ['my-model'],
		getProviderConfig: (): AIProviderConfig => ({
			name: 'ollama',
			models: ['my-model'],
			config: {},
		}),
		chat: async (
			_messages: Message[],
			_tools: Record<string, AISDKCoreTool>,
			callbacks: StreamCallbacks,
		): Promise<LLMChatResponse> => {
			callbacks.onToken?.(
				'{"status": "ok", "code": 200, "items": ["alpha", "beta"]}',
			);
			callbacks.onFinish?.();
			return {
				messages: [],
				finishReason: 'stop',
			};
		},
		clearContext: async () => {},
		getTimeout: () => undefined,
	};
}

test.serial('calibrateCommand handles reset subcommand', async t => {
	saveCalibrationProfile({
		provider: 'ollama',
		model: 'my-model',
		timestamp: Date.now(),
		overallScore: 80,
		tier: 'tier-1',
		recommendedProfile: 'full',
		recommendedToolMode: 'native',
		recommendedAggressiveCompact: false,
		testResults: [],
	});

	const result = await calibrateCommand.handler(['reset'], [], {
		provider: 'ollama',
		model: 'my-model',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
	t.is(getCalibrationProfile('ollama', 'my-model'), undefined);
});

test.serial('calibrateCommand handles view subcommand when no profile exists', async t => {
	const result = await calibrateCommand.handler(['view'], [], {
		provider: 'ollama',
		model: 'unknown-model',
		tokens: 0,
		getMessageTokens: () => 0,
	});

	t.truthy(result);
});

test.serial('calibrateCommand runs calibration benchmark with active client', async t => {
	const mockClient = createMockLLMClient();

	const result = await calibrateCommand.handler([], [], {
		provider: 'ollama',
		model: 'my-model',
		tokens: 0,
		getMessageTokens: () => 0,
		client: mockClient,
	});

	t.truthy(result);
	t.true(React.isValidElement(result));

	const saved = getCalibrationProfile('ollama', 'my-model');
	t.truthy(saved);
	t.is(saved?.model, 'my-model');
});
