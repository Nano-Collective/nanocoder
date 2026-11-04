import {spawnSync} from 'node:child_process';
import test from 'ava';

test('cli-highlight is loaded only when syntax highlighting is requested', t => {
	const script = `
		import {createRequire} from 'node:module';
		const require = createRequire(import.meta.url);
		const {highlightCode} = await import('./source/utils/syntax-highlighter.ts');
		const {default: stripAnsi} = await import('strip-ansi');
		const modulePath = require.resolve('cli-highlight');
		if (require.cache[modulePath]) {
			throw new Error('cli-highlight loaded before syntax highlighting was requested');
		}
		const output = highlightCode('const answer = 42;', {language: 'javascript'});
		if (!stripAnsi(output).includes('const answer = 42;')) {
			throw new Error('highlightCode did not preserve the source text');
		}
		if (!require.cache[modulePath]) {
			throw new Error('cli-highlight was not loaded on first use');
		}
	`;
	const result = spawnSync(
		process.execPath,
		['--import=tsx', '--input-type=module', '-e', script],
		{cwd: process.cwd(), encoding: 'utf8'},
	);

	t.is(result.status, 0, result.stderr || result.stdout);
	if (result.error) t.fail(result.error.message);
});
