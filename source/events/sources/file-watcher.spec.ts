import {mkdir, mkdtemp, rm, unlink, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {EventRouter} from '@/events/event-router';
import type {Event, Subscription, SubscriptionDispatcher} from '@/events/types';
import {FileWatcherSource} from './file-watcher';

console.log(`\nfile-watcher.spec.ts`);

function captureRouter(): {router: EventRouter; events: Event[]} {
	const events: Event[] = [];
	const dispatcher: SubscriptionDispatcher = {
		dispatch(_sub, event) {
			events.push(event);
		},
	};
	const router = new EventRouter(dispatcher);
	return {router, events};
}

function fileSub(id: string, paths?: string[]): Subscription {
	return {
		id,
		kind: 'file.changed',
		target: {kind: 'agent', name: 'docs'},
		source: 'frontmatter',
		ownerSkill: 'docs',
		filter: paths ? {paths} : undefined,
	};
}

async function waitFor(
	predicate: () => boolean,
	timeoutMs = 2000,
	intervalMs = 25,
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) return;
		await new Promise(r => setTimeout(r, intervalMs));
	}
	throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

test.serial('emits add / change / unlink events', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-spec-'));
	const {router, events} = captureRouter();
	router.subscribe(fileSub('s1'));
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
	});
	await source.start();

	try {
		const file = join(dir, 'thing.txt');
		await writeFile(file, 'one');
		await waitFor(() =>
			events.some(
				e =>
					e.kind === 'file.changed' &&
					e.payload.eventKind === 'add' &&
					e.payload.file === 'thing.txt',
			),
		);

		await writeFile(file, 'two');
		await waitFor(() =>
			events.some(
				e =>
					e.kind === 'file.changed' &&
					e.payload.eventKind === 'change' &&
					e.payload.file === 'thing.txt',
			),
		);

		await unlink(file);
		await waitFor(() =>
			events.some(
				e =>
					e.kind === 'file.changed' &&
					e.payload.eventKind === 'unlink' &&
					e.payload.file === 'thing.txt',
			),
		);

		t.pass();
	} finally {
		await source.stop();
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('paths emitted are relative to the watch root', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-spec-rel-'));
	const sub = join(dir, 'src', 'inner');
	await mkdir(sub, {recursive: true});

	const {router, events} = captureRouter();
	router.subscribe(fileSub('s1'));
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
	});
	await source.start();

	try {
		await writeFile(join(sub, 'leaf.ts'), 'x');
		await waitFor(() =>
			events.some(
				e =>
					e.kind === 'file.changed' &&
					e.payload.file.endsWith('leaf.ts') &&
					!e.payload.file.startsWith('/'),
			),
		);
		const match = events.find(
			e => e.kind === 'file.changed' && e.payload.file.endsWith('leaf.ts'),
		);
		t.regex(
			match?.kind === 'file.changed' ? match.payload.file : '',
			/^src[\\/]inner[\\/]leaf\.ts$/,
		);
	} finally {
		await source.stop();
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('subscriptions with paths filter narrow down events', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-spec-paths-'));
	const {router, events} = captureRouter();
	router.subscribe(fileSub('s1', ['docs/**']));
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
	});
	await source.start();

	try {
		await mkdir(join(dir, 'docs'));
		await mkdir(join(dir, 'src'));
		await writeFile(join(dir, 'docs', 'a.md'), 'docs');
		await writeFile(join(dir, 'src', 'a.ts'), 'src');

		// Wait for at least one event to come through
		await waitFor(() => events.length > 0);
		// Give time for both potential events to land
		await new Promise(r => setTimeout(r, 150));

		const matched = events.filter(
			e => e.kind === 'file.changed' && /docs/.test(e.payload.file),
		);
		const others = events.filter(
			e => e.kind === 'file.changed' && /^src/.test(e.payload.file),
		);

		// The router only dispatches to matching subscriptions, so the
		// captured-router only sees events that passed the path filter.
		t.true(matched.length > 0);
		t.is(others.length, 0);
	} finally {
		await source.stop();
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('stop releases the watcher and stops emitting', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-spec-stop-'));
	const {router, events} = captureRouter();
	router.subscribe(fileSub('s1'));
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
	});
	await source.start();
	await source.stop();

	try {
		await writeFile(join(dir, 'late.txt'), 'late');
		// Wait long enough that any pending events would have shown up
		await new Promise(r => setTimeout(r, 200));
		t.is(events.length, 0);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('closes the underlying watcher if initialization fails', async t => {
    let closeCalled = false;

    type WatchFn = typeof import('chokidar').watch;  // ← avoids importing watch itself

    const fakeWatcher = {
        on:   (_e: string, _cb: unknown) => fakeWatcher,
        once: (event: string, callback: (...args: unknown[]) => void) => {
            if (event === 'error') {
                setImmediate(() => callback(new Error('Simulated startup failure')));
            }
            return fakeWatcher;
        },
        close: async () => { closeCalled = true; },
    } as unknown as import('chokidar').FSWatcher;

    const {router} = captureRouter();
    const source = new FileWatcherSource(router, {
        root: '.',
        _watchFn: (() => fakeWatcher) as unknown as WatchFn,
    });

    const err = await t.throwsAsync(() => source.start());
    t.is(err?.message, 'Simulated startup failure');
    t.true(closeCalled, 'watcher.close() must be called on startup error');
});