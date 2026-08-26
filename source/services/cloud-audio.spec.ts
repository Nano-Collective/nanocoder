import { existsSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'ava';
import {
	CloudAudioError,
	CloudAudioUnsupportedError,
	supportsCloudAudio,
	synthesizeCloudSpeech,
	transcribeCloudAudio,
} from './cloud-audio.js';
import type { AIProviderConfig } from '@/types/config';

test('supportsCloudAudio detects OpenAI-compatible providers', t => {
	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test' },
	};
	t.deepEqual(supportsCloudAudio(openaiConfig), { stt: true, tts: true });

	const customOpenAIConfig: AIProviderConfig = {
		name: 'custom-ai',
		sdkProvider: 'openai-compatible',
		models: ['custom-model'],
		config: { baseURL: 'https://api.openai.com/v1', apiKey: 'sk-test' },
	};
	t.deepEqual(supportsCloudAudio(customOpenAIConfig), { stt: true, tts: true });

	const anthropicConfig: AIProviderConfig = {
		name: 'anthropic',
		sdkProvider: 'anthropic',
		models: ['claude-3-5-sonnet-20241022'],
		config: { apiKey: 'sk-ant' },
	};
	t.deepEqual(supportsCloudAudio(anthropicConfig), { stt: false, tts: false });

	t.deepEqual(supportsCloudAudio(null), { stt: false, tts: false });
});

test('transcribeCloudAudio throws CloudAudioUnsupportedError for non-cloud providers', async t => {
	const anthropicConfig: AIProviderConfig = {
		name: 'anthropic',
		sdkProvider: 'anthropic',
		models: ['claude-3'],
		config: { apiKey: 'sk-ant' },
	};

	await t.throwsAsync(
		async () => {
			await transcribeCloudAudio('/tmp/fake.wav', {
				providerConfig: anthropicConfig,
			});
		},
		{ instanceOf: CloudAudioUnsupportedError },
	);
});

test('transcribeCloudAudio successfully posts to transcription endpoint and parses text', async t => {
	const tmpAudio = join(tmpdir(), `test-audio-${Date.now()}.wav`);
	writeFileSync(tmpAudio, Buffer.from('RIFF mock wav data'));

	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test-key', baseURL: 'https://api.test.com/v1' },
	};

	let capturedUrl = '';
	let capturedAuth = '';

	const mockFetch = (async (url: string | URL | Request, init?: RequestInit) => {
		capturedUrl = String(url);
		capturedAuth = String(
			(init?.headers as Record<string, string>)?.Authorization,
		);
		return new Response(JSON.stringify({ text: 'transcribed speech from cloud' }), {
			status: 200,
			headers: { 'Content-Type': 'application/json' },
		});
	}) as typeof fetch;

	try {
		const text = await transcribeCloudAudio(tmpAudio, {
			providerConfig: openaiConfig,
			fetchFn: mockFetch,
		});

		t.is(text, 'transcribed speech from cloud');
		t.is(capturedUrl, 'https://api.test.com/v1/audio/transcriptions');
		t.is(capturedAuth, 'Bearer sk-test-key');
	} finally {
		if (existsSync(tmpAudio)) unlinkSync(tmpAudio);
	}
});

test('synthesizeCloudSpeech successfully posts to speech endpoint and writes output file', async t => {
	const tmpOut = join(tmpdir(), `test-tts-out-${Date.now()}.wav`);

	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test-key', baseURL: 'https://api.test.com/v1' },
	};

	let capturedBody = '';

	const mockFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
		capturedBody = String(init?.body);
		return new Response(Buffer.from('synthesized audio bytes'), {
			status: 200,
			headers: { 'Content-Type': 'audio/wav' },
		});
	}) as typeof fetch;

	try {
		await synthesizeCloudSpeech('Hello world', tmpOut, {
			providerConfig: openaiConfig,
			fetchFn: mockFetch,
		});

		t.true(existsSync(tmpOut));
		t.true(capturedBody.includes('Hello world'));
		t.true(capturedBody.includes('tts-1'));
	} finally {
		if (existsSync(tmpOut)) unlinkSync(tmpOut);
	}
});

test('cloud audio methods throw CloudAudioError on HTTP failure', async t => {
	const tmpAudio = join(tmpdir(), `test-audio-err-${Date.now()}.wav`);
	writeFileSync(tmpAudio, Buffer.from('RIFF mock wav data'));

	const openaiConfig: AIProviderConfig = {
		name: 'openai',
		sdkProvider: 'openai',
		models: ['gpt-4o'],
		config: { apiKey: 'sk-test-key' },
	};

	const mockErrorFetch = (async () => {
		return new Response('Rate limit exceeded', { status: 429 });
	}) as typeof fetch;

	try {
		await t.throwsAsync(
			async () => {
				await transcribeCloudAudio(tmpAudio, {
					providerConfig: openaiConfig,
					fetchFn: mockErrorFetch,
				});
			},
			{ instanceOf: CloudAudioError },
		);
	} finally {
		if (existsSync(tmpAudio)) unlinkSync(tmpAudio);
	}
});
