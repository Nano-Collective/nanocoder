import test from 'ava';
import {EventRouter, matchGlob, matchesFilter} from './event-router';
import type {Event, Subscription, SubscriptionDispatcher} from './types';

console.log(`\nevent-router.spec.ts`);

function makeDispatcher(): SubscriptionDispatcher & {
	calls: Array<{sub: Subscription; event: Event}>;
} {
	const calls: Array<{sub: Subscription; event: Event}> = [];
	return {
		calls,
		dispatch(sub, event) {
			calls.push({sub, event});
		},
	};
}

function fileChangedSub(
	id: string,
	overrides: Partial<Subscription> = {},
): Subscription {
	return {
		id,
		kind: 'file.changed',
		target: {kind: 'agent', name: 'docs'},
		source: 'frontmatter',
		ownerSkill: 'docs',
		...overrides,
	} as Subscription;
}

function cronSub(
	id: string,
	cron: string,
	overrides: Partial<Subscription> = {},
): Subscription {
	return {
		id,
		kind: 'schedule.cron',
		target: {kind: 'command', name: 'weekly-report'},
		source: 'manifest',
		ownerSkill: 'reports',
		filter: {cron},
		...overrides,
	} as Subscription;
}

function fileEvent(file: string, eventKind: 'add' | 'change' | 'unlink' = 'change'): Event {
	return {kind: 'file.changed', payload: {file, eventKind}, at: Date.now()};
}

function cronEvent(cron: string): Event {
	return {kind: 'schedule.cron', payload: {cron}, at: Date.now()};
}

function ciJobFailedSub(
	id: string,
	overrides: Partial<Subscription> = {},
): Subscription {
	return {
		id,
		kind: 'ci.job.failed',
		target: {kind: 'agent', name: 'verify-ci-investigator'},
		source: 'manifest',
		ownerSkill: 'builtin',
		...overrides,
	} as Subscription;
}

function ciJobFailedEvent(branch: string): Event {
	return {
		kind: 'ci.job.failed',
		payload: {
			runId: 1,
			workflowName: 'CI',
			branch,
			headSha: 'abc123',
			url: 'https://example.com/run/1',
		},
		at: Date.now(),
	};
}

test('subscribe + emit dispatches matching subscription', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(fileChangedSub('s1', {filter: {paths: ['docs/**']}}));

	await router.emit(fileEvent('docs/intro.md'));
	t.is(d.calls.length, 1);
	t.is(d.calls[0]?.sub.id, 's1');
});

test('emit skips non-matching path glob', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(fileChangedSub('s1', {filter: {paths: ['docs/**']}}));

	await router.emit(fileEvent('src/index.ts'));
	t.is(d.calls.length, 0);
});

test('emit respects eventKinds whitelist', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(
		fileChangedSub('s1', {
			filter: {paths: ['docs/**'], eventKinds: ['add']},
		}),
	);

	await router.emit(fileEvent('docs/intro.md', 'change'));
	t.is(d.calls.length, 0);
	await router.emit(fileEvent('docs/intro.md', 'add'));
	t.is(d.calls.length, 1);
});

test('emit with no filter dispatches all matching kind', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(fileChangedSub('s1')); // no filter

	await router.emit(fileEvent('anywhere/at/all.txt'));
	t.is(d.calls.length, 1);
});

test('cron filter is exact-match on cron string', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(cronSub('s1', '0 9 * * MON'));

	await router.emit(cronEvent('0 9 * * MON'));
	t.is(d.calls.length, 1);
	await router.emit(cronEvent('*/5 * * * *'));
	t.is(d.calls.length, 1);
});

test('multiple subscriptions on the same kind all fire if they match', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(fileChangedSub('a', {filter: {paths: ['docs/**']}}));
	router.subscribe(fileChangedSub('b', {filter: {paths: ['**/*.md']}}));

	await router.emit(fileEvent('docs/intro.md'));
	t.is(d.calls.length, 2);
	const ids = d.calls.map(c => c.sub.id).sort();
	t.deepEqual(ids, ['a', 'b']);
});

test('unsubscribe removes the subscription from dispatch', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(fileChangedSub('s1'));
	t.true(router.unsubscribe('s1'));

	await router.emit(fileEvent('any/file.md'));
	t.is(d.calls.length, 0);
});

test('duplicate subscription id throws', t => {
	const router = new EventRouter(makeDispatcher());
	router.subscribe(fileChangedSub('s1'));
	t.throws(() => router.subscribe(fileChangedSub('s1')), {
		message: /already registered/,
	});
});

test('listByKind returns the registered subscriptions for that kind only', t => {
	const router = new EventRouter(makeDispatcher());
	router.subscribe(fileChangedSub('a'));
	router.subscribe(cronSub('b', '* * * * *'));

	t.is(router.listByKind('file.changed').length, 1);
	t.is(router.listByKind('schedule.cron').length, 1);
});

test('ci.job.failed with no filter dispatches for any branch', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(ciJobFailedSub('s1'));

	await router.emit(ciJobFailedEvent('main'));
	t.is(d.calls.length, 1);
});

test('ci.job.failed branches filter glob-matches the payload branch', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(ciJobFailedSub('s1', {filter: {branches: ['release/**']}}));

	await router.emit(ciJobFailedEvent('feature-x'));
	t.is(d.calls.length, 0);
	await router.emit(ciJobFailedEvent('release/1.0'));
	t.is(d.calls.length, 1);
});

test('matchesFilter on kind mismatch returns false', t => {
	const sub = fileChangedSub('a');
	const event = cronEvent('* * * * *');
	t.false(matchesFilter(sub, event));
});

test('matchGlob: brace alternation', t => {
	t.true(matchGlob('*.{ts,tsx}', 'app.tsx'));
	t.true(matchGlob('*.{ts,tsx}', 'app.ts'));
	t.false(matchGlob('*.{ts,tsx}', 'app.js'));

	t.true(matchGlob('src/**/*.{ts,tsx}', 'src/a/b/app.tsx'));
	t.false(matchGlob('src/**/*.{ts,tsx}', 'src/a/b/app.css'));

	// A single alternative and more than two both hold.
	t.true(matchGlob('{docs}/**', 'docs/intro.md'));
	t.true(matchGlob('*.{js,ts,tsx,mts}', 'a.mts'));

	// `*` still stops at a directory boundary inside an alternative.
	t.false(matchGlob('*.{ts,tsx}', 'src/app.ts'));
});

test('matchGlob: unbalanced braces stay literal instead of throwing', t => {
	t.notThrows(() => matchGlob('docs/{a', 'docs/{a'));
	t.true(matchGlob('docs/{a', 'docs/{a'));
	t.false(matchGlob('docs/{a', 'docs/a'));
	t.true(matchGlob('a}b', 'a}b'));
});

test('matchGlob: a comma outside braces is literal', t => {
	t.true(matchGlob('a,b.md', 'a,b.md'));
	t.false(matchGlob('a,b.md', 'a.md'));
});

test('matchGlob: basic patterns', t => {
	t.true(matchGlob('docs/**', 'docs/intro.md'));
	t.true(matchGlob('docs/**', 'docs/deep/sub/file.md'));
	t.false(matchGlob('docs/**', 'src/index.ts'));
	t.true(matchGlob('**/*.md', 'docs/intro.md'));
	t.true(matchGlob('**/*.md', 'a/b/c.md'));
	t.false(matchGlob('**/*.md', 'a/b/c.txt'));
	t.true(matchGlob('src/*.ts', 'src/index.ts'));
	t.false(matchGlob('src/*.ts', 'src/deep/file.ts'));
	t.true(matchGlob('file.txt', 'file.txt'));
	t.false(matchGlob('file.txt', 'other.txt'));
});

test('matchGlob: globstar slash preserves filename and directory boundaries', t => {
	const cases: Array<[string, string, boolean]> = [
		['**/foo.ts', 'foo.ts', true],
		['**/foo.ts', 'a/foo.ts', true],
		['**/foo.ts', 'a/b/foo.ts', true],
		['**/foo.ts', 'barfoo.ts', false],
		['**/foo.ts', 'a/barfoo.ts', false],
		['**/package.json', 'mypackage.json', false],
		['src/**/x.ts', 'src/x.ts', true],
		['src/**/x.ts', 'src/a/x.ts', true],
		['src/**/x.ts', 'src/a/b/x.ts', true],
		['src/**/x.ts', 'src/abx.ts', false],
		['src/**/x.ts', 'src/a/abx.ts', false],
		['**/foo.ts', 'a\\foo.ts', true],
		['**/foo.ts', 'a\\barfoo.ts', false],
		['src\\**\\x.ts', 'src\\abx.ts', false],
		['**/{foo,bar}.ts', 'a/foo.ts', true],
		['**/{foo,bar}.ts', 'a/notfoo.ts', false],
		['docs/**/', 'docs/a.md', true],
		['docs/**/', 'docs/deep/sub/file.md', true],
		['docs/**/', 'src/a.md', false],
		['**/', 'foo.ts', true],
		['docs\\**\\', 'docs\\a.md', true],
		['docs/**', 'docs/deep/sub/file.md', true],
		['*a**a', 'a/a', true],
	];
	for (const [pattern, path, expected] of cases) {
		t.is(matchGlob(pattern, path), expected, `${pattern} vs ${path}`);
	}
});

test('file.changed globstar filter ignores look-alike filenames', async t => {
	const d = makeDispatcher();
	const router = new EventRouter(d);
	router.subscribe(fileChangedSub('exact-name', {filter: {paths: ['**/foo.ts']}}));

	await router.emit(fileEvent('barfoo.ts'));
	await router.emit(fileEvent('a/barfoo.ts'));
	t.is(d.calls.length, 0);
	await router.emit(fileEvent('foo.ts'));
	await router.emit(fileEvent('a/foo.ts'));
	t.deepEqual(d.calls.map(call => call.event.payload), [
		{file: 'foo.ts', eventKind: 'change'},
		{file: 'a/foo.ts', eventKind: 'change'},
	]);
});

// Chokidar reports the platform separator, so on Windows a `/`-authored
// pattern is asked to match `docs\guide.md`. Both directions matter: a
// segment pattern must still match, and `*` must not cross a backslash any
// more than it crosses a slash.
test('matchGlob: paths using Windows separators', t => {
	const cases: Array<[pattern: string, path: string, expected: boolean]> = [
		['docs/**', 'docs\\guide.md', true],
		['docs/**', 'docs\\api\\ref.md', true],
		['docs/*.md', 'docs\\guide.md', true],
		['k8s/**/*.yaml', 'k8s\\deploy.yaml', true],
		['k8s/**/*.yaml', 'k8s\\prod\\deploy.yaml', true],
		['src/**/*.ts', 'src\\deep\\file.ts', true],
		['**/*.md', 'docs\\intro.md', true],
		['docs/**', 'src\\index.ts', false],
		// `*` stops at a directory boundary, whichever separator draws it
		['*.md', 'sub\\a.md', false],
		['src/*.ts', 'src\\deep\\file.ts', false],
		['?.md', 'sub\\a.md', false],
	];
	for (const [pattern, path, expected] of cases) {
		t.is(matchGlob(pattern, path), expected, `${pattern} vs ${path}`);
	}
});

test('matchGlob: patterns authored with Windows separators', t => {
	t.true(matchGlob('docs\\**', 'docs/guide.md'));
	t.true(matchGlob('docs\\**', 'docs\\guide.md'));
	t.false(matchGlob('docs\\*.md', 'docs/deep/guide.md'));
});

// A dispatch resolves only when its triggered run ends, so subscriptions on
// one event must start together, not wait for each other.
test('emit starts every matching subscription without waiting for the others', async t => {
	const started: string[] = [];
	let release: () => void = () => {};
	const blocked = new Promise<void>(resolve => {
		release = resolve;
	});
	const router = new EventRouter({
		dispatch: async sub => {
			started.push(sub.id);
			if (sub.id === 'slow') await blocked;
		},
	});
	router.subscribe(cronSub('slow', '0 9 * * *'));
	router.subscribe(cronSub('fast', '0 9 * * *'));

	const done = router.emit(cronEvent('0 9 * * *'));
	await new Promise(resolve => setImmediate(resolve));
	t.deepEqual(started, ['slow', 'fast']);
	release();
	await done;
});

test('one failing subscription neither skips the others nor rejects emit', async t => {
	const dispatched: string[] = [];
	const errors: Array<{id: string; message: string}> = [];
	const router = new EventRouter(
		{
			dispatch(sub) {
				dispatched.push(sub.id);
				if (sub.id === 'throws') throw new Error('sync boom');
				if (sub.id === 'rejects') return Promise.reject(new Error('async boom'));
			},
		},
		(sub, _event, error) => {
			errors.push({id: sub.id, message: (error as Error).message});
		},
	);
	router.subscribe(cronSub('throws', '* * * * *'));
	router.subscribe(cronSub('rejects', '* * * * *'));
	router.subscribe(cronSub('ok', '* * * * *'));

	await t.notThrowsAsync(router.emit(cronEvent('* * * * *')));
	t.deepEqual(dispatched, ['throws', 'rejects', 'ok']);
	t.deepEqual(errors, [
		{id: 'throws', message: 'sync boom'},
		{id: 'rejects', message: 'async boom'},
	]);
});
