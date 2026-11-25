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
	timeoutMs = 5000,
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
	// Wait for chokidar's initial scan to settle before writing files
	await new Promise(r => setTimeout(r, 200));

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
	// Wait for chokidar's initial scan to settle before writing files
	await new Promise(r => setTimeout(r, 200));

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
		// Separators are normalized at this boundary, so the shape is `/` on
		// every platform — the router, activity reports and the payload handed
		// to a triggered agent all read the same path.
		t.regex(
			match?.kind === 'file.changed' ? match.payload.file : '',
			/^src\/inner\/leaf\.ts$/,
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
	// Wait for chokidar's initial scan to settle before writing files
	await new Promise(r => setTimeout(r, 200));

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

test.serial('detectAiComments emits file.ai-comment for new AI! markers', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-ai-spec-'));
	const {router, events} = captureRouter();
	router.subscribe({
		id: 'ai-sub',
		kind: 'file.ai-comment',
		target: {kind: 'agent', name: 'fixer'},
		source: 'frontmatter',
		ownerSkill: 'auto-fix',
	});
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
		detectAiComments: true,
	});
	await source.start();
	await new Promise(r => setTimeout(r, 200));

	try {
		const file = join(dir, 'code.ts');
		await writeFile(
			file,
			'function foo() {\n  // TODO: fix null check missing AI!\n  return null;\n}',
		);

		await waitFor(() =>
			events.some(
				e =>
					e.kind === 'file.ai-comment' &&
					e.payload.marker === 'AI!' &&
					e.payload.comment.includes('fix null check missing'),
			),
		);

		const aiEvents = events.filter(e => e.kind === 'file.ai-comment');
		t.is(aiEvents.length, 1);
		const evt = aiEvents[0];
		if (evt?.kind === 'file.ai-comment') {
			t.is(evt.payload.marker, 'AI!');
			t.is(evt.payload.line, 2);
			t.is(evt.payload.file, 'code.ts');
			t.true(evt.payload.comment.includes('fix null check missing'));
			t.true(evt.payload.context.includes('TODO'));
		}
	} finally {
		await source.stop();
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('detectAiComments supports AI? and ignores a bare AI', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-ai-markers-'));
	const {router, events} = captureRouter();
	router.subscribe({
		id: 'ai-sub',
		kind: 'file.ai-comment',
		target: {kind: 'agent', name: 'fixer'},
		source: 'frontmatter',
		ownerSkill: 'auto-fix',
	});
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
		detectAiComments: true,
	});
	await source.start();
	await new Promise(r => setTimeout(r, 200));

	try {
		const file = join(dir, 'test.py');
		await writeFile(
			file,
			'# Should this be async? AI?\ndef sync_func():\n  pass\n# Refactor this AI\nold_code()',
		);

		await waitFor(() =>
			events.some(e => e.kind === 'file.ai-comment'),
		);
		// Give a second, wrong event time to show up before counting.
		await new Promise(r => setTimeout(r, 300));

		const aiEvents = events.filter(e => e.kind === 'file.ai-comment');
		t.is(aiEvents.length, 1, 'only the AI? line is a marker');

		const markers = aiEvents
			.filter((e): e is typeof e & {kind: 'file.ai-comment'} => e.kind === 'file.ai-comment')
			.map(e => e.payload.marker);
		t.deepEqual(markers, ['AI?']);
	} finally {
		await source.stop();
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('detectAiComments only emits for new markers, not existing ones', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-ai-dedupe-'));
	const {router, events} = captureRouter();
	router.subscribe({
		id: 'ai-sub',
		kind: 'file.ai-comment',
		target: {kind: 'agent', name: 'fixer'},
		source: 'frontmatter',
		ownerSkill: 'auto-fix',
	});
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
		detectAiComments: true,
	});
	await source.start();
	await new Promise(r => setTimeout(r, 200));

	try {
		const file = join(dir, 'stable.js');
		// Initial write with marker
		await writeFile(file, '// existing issue AI!\nlet x = 1;');

		await waitFor(() =>
			events.some(e => e.kind === 'file.ai-comment'),
		);

		const initialCount = events.filter(e => e.kind === 'file.ai-comment').length;

		// Modify file without changing the marker
		await writeFile(file, '// existing issue AI!\nlet x = 2;');
		await new Promise(r => setTimeout(r, 300));

		// Should not emit duplicate event for same marker
		const finalCount = events.filter(e => e.kind === 'file.ai-comment').length;
		t.is(finalCount, initialCount, 'Should not re-emit for unchanged markers');
	} finally {
		await source.stop();
		await rm(dir, {recursive: true, force: true});
	}
});

test.serial('detectAiComments disabled by default', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'fw-no-ai-'));
	const {router, events} = captureRouter();
	router.subscribe({
		id: 'ai-sub',
		kind: 'file.ai-comment',
		target: {kind: 'agent', name: 'fixer'},
		source: 'frontmatter',
		ownerSkill: 'auto-fix',
	});
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
		// detectAiComments NOT set (defaults to false)
	});
	await source.start();
	await new Promise(r => setTimeout(r, 200));

	try {
		const file = join(dir, 'ignored.ts');
		await writeFile(file, '// TODO: fix this AI!\ncode();');

		await new Promise(r => setTimeout(r, 300));

		const aiEvents = events.filter(e => e.kind === 'file.ai-comment');
		t.is(aiEvents.length, 0, 'Should not emit AI comment events when disabled');
	} finally {
		await source.stop();
		await rm(dir, {recursive: true, force: true});
	}
});

// ---------------------------------------------------------------------------
// AI marker detection: what counts, and what counts as new
// ---------------------------------------------------------------------------

type AiCommentEvent = Extract<Event, {kind: 'file.ai-comment'}>;

function aiCommentEvents(events: Event[]): AiCommentEvent[] {
	return events.filter((e): e is AiCommentEvent => e.kind === 'file.ai-comment');
}

async function watchForMarkers(
	prepare?: (dir: string) => Promise<void>,
): Promise<{
	dir: string;
	events: Event[];
	source: FileWatcherSource;
	cleanup: () => Promise<void>;
}> {
	const dir = await mkdtemp(join(tmpdir(), 'fw-ai-markers-spec-'));
	await prepare?.(dir);
	const {router, events} = captureRouter();
	router.subscribe({
		id: 'ai-sub',
		kind: 'file.ai-comment',
		target: {kind: 'agent', name: 'fixer'},
		source: 'frontmatter',
		ownerSkill: 'auto-fix',
	});
	const source = new FileWatcherSource(router, {
		root: dir,
		usePolling: true,
		pollingInterval: 50,
		detectAiComments: true,
	});
	await source.start();
	await new Promise(r => setTimeout(r, 200));
	return {
		dir,
		events,
		source,
		cleanup: async () => {
			await source.stop();
			await rm(dir, {recursive: true, force: true});
		},
	};
}

test.serial('detectAiComments ignores prose, bare AI and non-comment lines', async t => {
	const {dir, events, cleanup} = await watchForMarkers();
	try {
		// Ordinary text that merely ends in "AI", plus one real marker so we
		// know the file was read before counting.
		await writeFile(
			join(dir, 'code.ts'),
			[
				'// this module wraps the AI',
				'// we should call the ai',
				'# A short history of AI',
				'x = a * b + c AI',
				'const u = "https://example.com/AI!";',
				'foo(AI!);',
				'// the one real request AI!',
			].join('\n'),
		);
		// A prose file is never scanned, even with a marker in it.
		await writeFile(join(dir, 'notes.md'), '<!-- fix this AI! -->\n# note AI?\n');

		await waitFor(() => aiCommentEvents(events).length >= 1);
		await new Promise(r => setTimeout(r, 400));

		const found = aiCommentEvents(events);
		t.is(found.length, 1);
		t.is(found[0]?.payload.file, 'code.ts');
		t.is(found[0]?.payload.comment, 'the one real request');
		t.is(found[0]?.payload.line, 7);
	} finally {
		await cleanup();
	}
});

test.serial('detectAiComments recognises each comment style for AI! and AI?', async t => {
	const {dir, events, cleanup} = await watchForMarkers();
	try {
		await writeFile(
			join(dir, 'styles.ts'),
			[
				'// slash comment AI!',
				'# hash comment AI?',
				'-- sql comment AI!',
				'/* one line block AI! */',
				'<!-- html comment AI? -->',
				' * javadoc line AI!',
				'run(); // trailing comment AI?',
			].join('\n'),
		);
		await waitFor(() => aiCommentEvents(events).length >= 7);
		const comments = aiCommentEvents(events).map(e => e.payload.comment);
		t.deepEqual(comments, [
			'slash comment',
			'hash comment',
			'sql comment',
			'one line block',
			'html comment',
			'javadoc line',
			'trailing comment',
		]);
	} finally {
		await cleanup();
	}
});

test.serial('detectAiComments does not re-emit a marker whose line moved', async t => {
	const {dir, events, cleanup} = await watchForMarkers();
	try {
		const file = join(dir, 'moves.ts');
		await writeFile(file, '// first AI!\n// second AI?\nbody();\n');
		await waitFor(() => aiCommentEvents(events).length >= 2);
		t.is(aiCommentEvents(events).length, 2);

		// A header line (as an agent's own edit might add) shifts both markers.
		await writeFile(file, 'import x;\nimport y;\n// first AI!\n// second AI?\nbody();\n');
		await new Promise(r => setTimeout(r, 500));
		t.is(aiCommentEvents(events).length, 2, 'moved markers are not new');

		// A genuinely new marker still fires, once.
		await writeFile(
			file,
			'import x;\nimport y;\n// first AI!\n// second AI?\nbody();\n// third AI!\n',
		);
		await waitFor(() => aiCommentEvents(events).length >= 3);
		await new Promise(r => setTimeout(r, 300));
		const all = aiCommentEvents(events);
		t.is(all.length, 3);
		t.is(all[2]?.payload.comment, 'third');
	} finally {
		await cleanup();
	}
});

test.serial('detectAiComments counts repeated identical markers separately', async t => {
	const {dir, events, cleanup} = await watchForMarkers();
	try {
		const file = join(dir, 'repeat.ts');
		await writeFile(file, '// same thing AI!\n');
		await waitFor(() => aiCommentEvents(events).length >= 1);

		// The same text on a second line is a second request.
		await writeFile(file, '// same thing AI!\nx();\n// same thing AI!\n');
		await waitFor(() => aiCommentEvents(events).length >= 2);
		await new Promise(r => setTimeout(r, 300));
		t.is(aiCommentEvents(events).length, 2);
		t.is(aiCommentEvents(events)[1]?.payload.line, 3);
	} finally {
		await cleanup();
	}
});

test.serial('detectAiComments does not report markers that existed before startup', async t => {
	const {dir, events, cleanup} = await watchForMarkers(async d => {
		await writeFile(join(d, 'old.ts'), '// old request AI!\n// older one AI?\nbody();\n');
	});
	try {
		// Nothing is emitted just for the watcher starting.
		await new Promise(r => setTimeout(r, 300));
		t.is(aiCommentEvents(events).length, 0);

		// The first save only reports what was added.
		await writeFile(
			join(dir, 'old.ts'),
			'// old request AI!\n// older one AI?\nbody();\n// brand new AI!\n',
		);
		await waitFor(() => aiCommentEvents(events).length >= 1);
		await new Promise(r => setTimeout(r, 300));
		const found = aiCommentEvents(events);
		t.is(found.length, 1);
		t.is(found[0]?.payload.comment, 'brand new');
	} finally {
		await cleanup();
	}
});
