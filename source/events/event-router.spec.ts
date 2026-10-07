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
