import test from 'ava';
import {filterMiniMaxModels} from './minimax-models';

const models = (ids: string[]) => ids.map(id => ({id, name: id, metadata: 42}));

for (const host of ['api.minimax.io', 'api.minimax.cn']) {
	test(`discovery on ${host} prefers Flash and preserves media`, t => {
		const input = models([
			'MiniMax-M3',
			'MiniMax-M2.7',
			'MiniMax-M3.1-Flash-Preview',
			'MiniMax-Text-01',
			'abab6.5-chat',
			'speech-2.8-hd',
			'MiniMax-M3.1-Flash',
			'MiniMax-Hailuo-2.3',
		]);
		const output = filterMiniMaxModels(input, `https://${host}/anthropic/v1`);
		t.deepEqual(output.map(m => m.id), [
			'MiniMax-M3.1-Flash',
			'speech-2.8-hd',
			'MiniMax-M3',
			'MiniMax-Hailuo-2.3',
		]);
		t.is(output[0], input[6]);
		t.is(input.length, 8);
	});
}

for (const [url, flash, m3, legacy, unverified] of [
	[
		'https://openrouter.ai/api/v1',
		'minimax/minimax-m3.1-flash:free',
		'minimax/minimax-m3',
		'minimax/minimax-m2.7',
		'minimax/minimax-m3.1-flash',
	],
	[
		'https://opencode.ai/zen/v1',
		'minimax-m3.1-flash-free',
		'minimax-m3',
		'minimax-m2.5-free',
		'minimax-m3.1-flash',
	],
]) {
	test(`discovery uses only returned verified IDs on ${url}`, t => {
		const input = models([
			'openai/gpt-4.1',
			m3,
			legacy,
			'anthropic/claude-sonnet-4',
			flash,
			unverified,
			'minimax/speech-2.8-hd',
		]);
		t.deepEqual(filterMiniMaxModels(input, url).map(m => m.id), [
			'openai/gpt-4.1',
			flash,
			'anthropic/claude-sonnet-4',
			m3,
			'minimax/speech-2.8-hd',
		]);
		t.deepEqual(filterMiniMaxModels(models([legacy]), url), []);
	});
}

test('legacy vision-language text choices are hidden without touching media IDs', t => {
	t.deepEqual(filterMiniMaxModels(models([
		'MiniMax-VL-01',
		'MiniMax-Text-01',
		'MiniMax-Speech-2.8',
		'MiniMax-Hailuo-2.3',
	]), 'https://api.minimax.io/v1').map(model => model.id), [
		'MiniMax-Speech-2.8',
		'MiniMax-Hailuo-2.3',
	]);
});

test('custom, local and lookalike endpoints preserve every explicit ID', t => {
	const input = models(['MiniMax-M2.7', 'custom-model', 'minimax/minimax-m2']);
	for (const url of [
		'https://custom.example/v1',
		'http://localhost:11434',
		'https://api.minimax.io.example/v1',
		'https://example.com/openrouter.ai',
		'https://opencode.ai/custom/v1',
		'https://opencode.ai/zenith/v1',
		'invalid',
	]) {
		t.is(filterMiniMaxModels(input, url), input);
	}
});
