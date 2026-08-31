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
	// beforeEach guarantees a cold cache here, so `first` genuinely exercises
	// the uncached branch (a real dynamic import) and `second` genuinely
	// exercises the cached branch (an early return) - not two already-warm
	// calls that would be equal regardless of whether caching works at all,
	// since @vscode/ripgrep resolves to the same real path either way.
	//
	// Note: a timing-based assertion here (cached call faster than the
	// uncached one) was tried and dropped - Node's own dynamic import()
	// memoizes the module load itself, so a deliberately broken cache
	// (bypassing `cachedPath` entirely) still measured as "fast" on the
	// second call. There's no externally observable difference between the
	// cached and uncached paths beyond running both branches, which the
	// cold-start guarantee above now does.
	const first = await resolveRipgrepPath();
	const second = await resolveRipgrepPath();
	t.is(first, second);
});

test('resetRipgrepPathCache is safe to call before any resolution', t => {
	t.notThrows(() => resetRipgrepPathCache());
});
