import {execFileSync} from 'node:child_process';
import test from 'ava';
import {resolveRipgrepPath} from './ripgrep-path.js';

console.log(`\nripgrep-path.spec.ts`);

test('resolveRipgrepPath resolves a real, runnable rg binary', async t => {
	const rgPath = await resolveRipgrepPath();
	t.truthy(rgPath);

	const output = execFileSync(rgPath, ['--version'], {encoding: 'utf8'});
	t.regex(output, /^ripgrep \d+\.\d+\.\d+/);
});

test('resolveRipgrepPath caches the result across calls', async t => {
	const first = await resolveRipgrepPath();
	const second = await resolveRipgrepPath();
	t.is(first, second);
});
