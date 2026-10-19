import test from 'ava';
import {handleWebCommand} from './commands.js';

test('web commands return browser feedback instead of opening terminal interactions', async t => {
	const notices: string[] = [];
	let resets = 0;
	const handlers = {resetSession: async () => {resets++;}, getSettings: () => ({provider: 'local', model: 'small', mode: 'normal'}), notice: (text: string) => notices.push(text)};
	t.false(await handleWebCommand('hello', handlers));
	await handleWebCommand('/status', handlers);
	t.true(notices[0].includes('Model: small'));
	await handleWebCommand('/model', handlers);
	t.true(notices[1].includes('gear button'));
	await handleWebCommand('/clear', handlers);
	t.is(resets, 1);
	await t.throwsAsync(handleWebCommand('/checkpoint load', handlers), {message: /not available in web mode/});
	await t.throwsAsync(handleWebCommand('!ls', handlers), {message: /not available in web mode/});
});
