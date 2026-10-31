import type {LanguageModel} from 'ai';
import test from 'ava';
import {type Agent, MockAgent} from 'undici';
import type {AIProviderConfig} from '@/types/index';
import {PROVIDER_TEMPLATES} from '@/wizards/templates/provider-templates';
import {createProvider} from '../providers/provider-factory';
import {handleChat} from './chat-handler';

// Exercise the real provider factory, chat handler and pinned SDK serializer.
// MockAgent blocks every request that is not explicitly intercepted.
async function captureRequest(
	baseURL: string,
	modelId: string,
	sdkProvider: 'anthropic' | 'openai-compatible',
) {
	const agent = new MockAgent();
	agent.disableNetConnect();
	let body: Record<string, unknown> | undefined;
	const url = new URL(baseURL);
	const path = `${url.pathname}/${sdkProvider === 'anthropic' ? 'messages' : 'chat/completions'}`;
	agent
		.get(url.origin)
		.intercept({path, method: 'POST'})
		.reply(options => {
			body = JSON.parse(String(options.body));
			return {statusCode: 400, data: {error: {message: 'offline capture'}}};
		});

	const config: AIProviderConfig = {
		name: 'MiniMax Coding',
		type: 'openai',
		sdkProvider,
		models: [modelId],
		maxOutputTokens: 8192,
		config: {baseURL, apiKey: 'offline-test-key'},
	};
	const originalFetch = globalThis.fetch;
	// Block optional models.dev metadata traffic as well as inference traffic.
	globalThis.fetch = async () => new Response('{}');
	try {
		const tagged = await createProvider(config, agent as unknown as Agent);
		const model = tagged.provider(modelId) as LanguageModel;
		await handleChat({
			model,
			currentModel: modelId,
			providerConfig: config,
			messages: [
				{role: 'system', content: 'Be helpful.'},
				{role: 'user', content: 'Previous turn'},
				{role: 'assistant', content: 'Saved reply'},
				{
					role: 'user',
					content: 'Describe this',
					images: [{data: 'aGVsbG8=', mediaType: 'image/png'}],
				},
			],
			tools: {},
			callbacks: {},
			maxRetries: 0,
		}).catch(() => undefined);
		agent.assertNoPendingInterceptors();
		return body;
	} finally {
		globalThis.fetch = originalFetch;
		await agent.close();
	}
}

for (const host of ['api.minimax.io', 'api.minimax.cn']) {
	for (const sdkProvider of ['anthropic', 'openai-compatible'] as const) {
		for (const model of ['MiniMax-M3.1-Flash', 'MiniMax-M3', 'MiniMax-M2.7']) {
			test.serial(`${host} ${sdkProvider} sends ${model} unchanged`, async t => {
				const prefix = sdkProvider === 'anthropic' ? '/anthropic' : '';
				const body = await captureRequest(
					`https://${host}${prefix}/v1`,
					model,
					sdkProvider,
				);
				t.is(body?.model, model);
				t.is(body?.stream, true);
				t.is(body?.max_tokens, 8192);
				// Let MiniMax apply its model-specific thinking/effort defaults.
				for (const field of [
					'thinking',
					'reasoning_effort',
					'output_config',
					'service_tier',
					'reasoning_split',
				]) {
					t.false(Object.hasOwn(body ?? {}, field));
				}
				const serialized = JSON.stringify(body?.messages);
				t.true(serialized.includes('Saved reply'));
				t.true(serialized.includes('aGVsbG8='));
				t.true(serialized.includes('image/png'));
			});
		}
	}
}

test.serial('wizard default reaches the Anthropic HTTP request as Flash', async t => {
	const template = PROVIDER_TEMPLATES.find(item => item.id === 'minimax-coding');
	t.truthy(template);
	const defaults = Object.fromEntries(
		template!.fields.map(field => [field.name, field.default ?? '']),
	);
	const saved = template!.buildConfig({...defaults, apiKey: 'offline-test-key'});
	t.deepEqual(saved.models, ['MiniMax-M3.1-Flash', 'MiniMax-M3']);
	const body = await captureRequest(saved.baseUrl!, saved.models[0], 'anthropic');
	t.is(body?.model, 'MiniMax-M3.1-Flash');
});

for (const [baseURL, model] of [
	['https://custom.example/v1', 'my-legacy-minimax'],
	['https://api.openai.com/v1', 'gpt-4.1'],
	['https://openrouter.ai/api/v1', 'minimax/minimax-m3.1-flash:free'],
	['https://openrouter.ai/api/v1', 'minimax/minimax-m2.7'],
	['https://opencode.ai/zen/v1', 'minimax-m3.1-flash-free'],
]) {
	test.serial(`explicit ${model} survives the HTTP boundary`, async t => {
		const body = await captureRequest(baseURL, model, 'openai-compatible');
		t.is(body?.model, model);
	});
}
