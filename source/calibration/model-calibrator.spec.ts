import test from 'ava';
import type {CalibrationProfile} from '@/types/calibration';
import type {
	AIProviderConfig,
	AISDKCoreTool,
	LLMChatResponse,
	LLMClient,
	Message,
	StreamCallbacks,
} from '@/types/index';
import {runCalibration} from './model-calibrator';

function createMockLLMClient(
	responses: Record<string, string>,
	modelName = 'custom-local-model',
	providerName = 'ollama',
): LLMClient {
	return {
		getCurrentModel: () => modelName,
		setModel: () => {},
		getContextSize: () => 32768,
		getAvailableModels: async () => [modelName],
		getProviderConfig: (): AIProviderConfig => ({
			name: providerName,
			models: [modelName],
			config: {baseURL: 'http://localhost:11434/v1'},
		}),
		chat: async (
			messages: Message[],
			_tools: Record<string, AISDKCoreTool>,
			callbacks: StreamCallbacks,
		): Promise<LLMChatResponse> => {
			const prompt = messages[0]?.content || '';
			let reply = 'default test response';
			for (const [key, value] of Object.entries(responses)) {
				if (prompt.includes(key)) {
					reply = value;
					break;
				}
			}
			callbacks.onToken?.(reply);
			callbacks.onFinish?.();
			return {
				messages: [],
				finishReason: 'stop',
				tokenUsage: {prompt: 10, completion: 20, total: 30},
			};
		},
		clearContext: async () => {},
		getTimeout: () => 30000,
	};
}

test('runCalibration assigns Tier 1 (Full) when model passes all benchmark tests', async t => {
	const client = createMockLLMClient({
		'{"status": "ok"':
			'{"status": "ok", "code": 200, "items": ["alpha", "beta"]}',
		'CALIBRATE': '- item_1\n- item_2 CALIBRATE\n- item_3',
		'<tool_call':
			'<tool_call name="read_file"><path>source/app.tsx</path></tool_call>',
	});

	const profile: CalibrationProfile = await runCalibration(client);

	t.is(profile.model, 'custom-local-model');
	t.is(profile.provider, 'ollama');
	t.is(profile.overallScore, 100);
	t.is(profile.tier, 'tier-1');
	t.is(profile.recommendedProfile, 'full');
	t.is(profile.recommendedToolMode, 'native');
	t.false(profile.recommendedAggressiveCompact);
	t.is(profile.testResults.length, 3);
	t.true(profile.testResults.every(r => r.passed));
});

test('runCalibration assigns Tier 2 (Minimal) when model has moderate score', async t => {
	const client = createMockLLMClient({
		'{"status": "ok"':
			'```json\n{"status": "ok", "code": 200, "items": ["alpha", "beta"]}\n```', // 80
		'CALIBRATE': '- item_1\n- item_2 CALIBRATE\n- item_3\n- item_4', // partial
		'<tool_call': 'I will call read_file for you.', // 0
	});

	const profile = await runCalibration(client);

	t.is(profile.tier, 'tier-2');
	t.is(profile.recommendedProfile, 'minimal');
	t.is(profile.recommendedToolMode, 'xml');
	t.true(profile.recommendedAggressiveCompact);
});

test('runCalibration assigns Tier 3 (Nano) when model fails benchmarks', async t => {
	const client = createMockLLMClient({
		'{"status": "ok"': 'I do not know JSON.',
		'CALIBRATE': 'No items.',
		'<tool_call': 'Cannot format XML.',
	});

	const profile = await runCalibration(client);

	t.is(profile.tier, 'tier-3');
	t.is(profile.recommendedProfile, 'nano');
	t.is(profile.recommendedToolMode, 'xml');
	t.true(profile.overallScore < 50);
});
