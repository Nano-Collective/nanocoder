import test from 'ava';
import {
	isOpenLLMProvider,
	OPENLLM_INSTALL_COMMAND,
	openLLMUnreachableHint,
} from './openllm-hints.js';

test('isOpenLLMProvider matches a local daemon URL only', t => {
	t.true(isOpenLLMProvider('my-gateway', 'http://127.0.0.1:8787/v1'));
	t.true(isOpenLLMProvider(undefined, 'http://localhost:8787/v1'));
	t.true(isOpenLLMProvider('OpenLLM', 'http://127.0.0.1:9000/v1'));
	t.false(isOpenLLMProvider('OpenLLM', 'https://www.openllm.sh/v1'));
	t.false(isOpenLLMProvider('OpenLLM'));
	t.false(isOpenLLMProvider('Ollama', 'http://localhost:11434/v1'));
	t.false(isOpenLLMProvider(undefined, 'not a url'));
});

test('openLLMUnreachableHint suggests openllm start when the CLI is installed', t => {
	t.is(
		openLLMUnreachableHint(() => true),
		'OpenLLM is not running. Run `openllm start`, then try again.',
	);
});

test('openLLMUnreachableHint shows the install command when the CLI is missing', t => {
	const hint = openLLMUnreachableHint(() => false);
	t.true(hint.includes(OPENLLM_INSTALL_COMMAND));
	t.true(hint.includes('openllm login'));
});
