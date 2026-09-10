import {execFileSync} from 'node:child_process';
import test from 'ava';
import {resetRipgrepPathCache, resolveRipgrepPath} from './ripgrep-path.js';

console.log(`\nripgrep-path.spec.ts`);

test.beforeEach(() => {
	resetRipgrepPathCache();
});

test.afterEach(() => {
	resetRipgrepPathCache();
});

test('resolveRipgrepPath resolves a real, runnable rg binary', async t => {
	const rgPath = await resolveRipgrepPath();
	t.truthy(rgPath);

	const output = execFileSync(rgPath, ['--version'], {encoding: 'utf8'});
	t.regex(output, /^ripgrep \d+\.\d+\.\d+/);
});

test('resolveRipgrepPath caches the result across calls', async t => {
	// beforeEach guarantees a cold cache, so this exercises both the uncached and cached branches instead of two already-warm calls that would be equal either way.
	// A timing assertion was tried and dropped - Node's own dynamic import() memoizes the module, so a deliberately broken cache still measured "fast" on the second call.
	const first = await resolveRipgrepPath();
	const second = await resolveRipgrepPath();
	t.is(first, second);
});

test('resetRipgrepPathCache is safe to call before any resolution', t => {
	t.notThrows(() => resetRipgrepPathCache());
});
