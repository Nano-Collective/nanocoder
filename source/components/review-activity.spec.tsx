import test from 'ava';
import React from 'react';
import {createReviewFixtureTools, createReviewGitFixture} from '@/review/review-test-helpers';
import {resolveReviewScope} from '@/review/review-resolver';
import {ReviewActivity} from './review-activity';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {ReviewActivityStore} from '@/review/review-activity';

function tick(ms = 80): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}

test('review activity updates while a coordinator is awaiting work', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	const store = new ReviewActivityStore({reviewId: 'live-review'});
	const tools = createReviewFixtureTools(fixture);
	const executeGit = tools.execGit;
	let resumeGit: (() => void) | undefined;
	let gitStarted: (() => void) | undefined;
	const waitingForGit = new Promise<void>(resolve => {
		resumeGit = resolve;
	});
	const gitCallStarted = new Promise<void>(resolve => {
		gitStarted = resolve;
	});
	tools.execGit = async (args, signal) => {
		if (args[0] === 'rev-parse' && args.includes('--show-toplevel')) {
			gitStarted?.();
			await waitingForGit;
		}
		return executeGit(args, signal);
	};
	const {lastFrame, unmount} = renderWithTheme(
		<ReviewActivity store={store} />,
	);
	await tick();

	const resolution = resolveReviewScope('/review working tree', {activity: store, tools});
	await gitCallStarted;
	await tick();
	t.true(lastFrame()?.includes('Locating the repository root'));
	t.is(store.getStatus(), 'running');

	resumeGit?.();
	const result = await resolution;
	await tick();
	t.is(result.status, 'ready');
	t.true(lastFrame()?.includes('completed'));
	unmount();
});

test('D expands bounded safe activity details and Escape cancels the run', async t => {
	const store = new ReviewActivityStore({reviewId: 'expand-review'});
	const controller = new AbortController();
	let cancelCalls = 0;
	const event = store.begin({
		source: 'tool',
		name: 'git fetch',
		args: ['fetch', '--no-tags', 'origin', 'refs/heads/feature'],
		summary: 'Fetching a pinned remote branch',
	});
	event.progress('Remote object received');
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<ReviewActivity
			store={store}
			interactive
			onCancel={() => {
				cancelCalls += 1;
				controller.abort();
			}}
		/>,
	);
	await tick();

	t.false(lastFrame()?.includes('args:'));
	stdin.write('d');
	await tick();
	t.true(lastFrame()?.includes('args: fetch --no-tags origin refs/heads/feature'));
	t.true(lastFrame()?.includes('D details · Esc cancel'));

	stdin.write('\u001B');
	stdin.write('\u001B');
	await tick();
	t.true(controller.signal.aborted);
	t.is(cancelCalls, 1);
	event.cancel('Stopped by user');
	store.finish('cancelled');
	await tick();
	t.true(lastFrame()?.includes('cancelled'));
	unmount();
});

test('activity keybindings are inactive unless the review view is focused', async t => {
	const store = new ReviewActivityStore({reviewId: 'inactive-review'});
	store.begin({
		source: 'tool',
		name: 'git fetch',
		args: ['fetch', 'origin'],
		summary: 'Fetching a pinned branch',
	});
	const {stdin, lastFrame, unmount} = renderWithTheme(
		<ReviewActivity store={store} />,
	);
	await tick();
	stdin.write('d');
	await tick();

	t.false(lastFrame()?.includes('args:'));
	t.false(lastFrame()?.includes('D details'));
	unmount();
});

test('activity view unsubscribes when unmounted', async t => {
	const store = new ReviewActivityStore({reviewId: 'cleanup-review'});
	const subscribe = store.subscribe.bind(store);
	let didUnsubscribe = false;
	store.subscribe = listener => {
		const unsubscribe = subscribe(listener);
		return () => {
			didUnsubscribe = true;
			unsubscribe();
		};
	};
	const {unmount} = renderWithTheme(<ReviewActivity store={store} />);
	await tick();
	unmount();

	t.true(didUnsubscribe);
});
