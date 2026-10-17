import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	clearSpanHandles,
	consumeSpanHandle,
	extractLineRange,
	registerSpanForRange,
	registerSpanWithContent,
	resolveSpanHandle,
} from './span-handles';

console.log(`\nspan-handles.spec.ts`);

test.beforeEach(() => {
	clearSpanHandles();
});

async function withTempFile<T>(
	content: string,
	fn: (path: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), 'span-handles-'));
	const path = join(dir, 'file.ts');
	try {
		await writeFile(path, content, 'utf-8');
		return await fn(path);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
}

// ============================================================================
// extractLineRange
// ============================================================================

test.serial('extractLineRange slices 1-indexed inclusive ranges', t => {
	const content = 'a\nb\nc\nd\ne';
	t.is(extractLineRange(content, 2, 4), 'b\nc\nd');
	t.is(extractLineRange(content, 1, 1), 'a');
	t.is(extractLineRange(content, 1, 5), content);
});

// ============================================================================
// register + resolve round trip
// ============================================================================

test.serial('resolves a freshly registered handle as ok', async t => {
	await withTempFile('line1\nline2\nline3\n', async path => {
		const handle = registerSpanForRange(path, 2, 2, 'line1\nline2\nline3\n');
		const resolution = await resolveSpanHandle(handle);
		t.is(resolution.status, 'ok');
		if (resolution.status === 'ok') {
			t.is(resolution.path, path);
			t.is(resolution.startLine, 2);
			t.is(resolution.endLine, 2);
		}
	});
});

test.serial('accepts the handle with or without the @span: prefix', async t => {
	await withTempFile('only line\n', async path => {
		const handle = registerSpanForRange(path, 1, 1, 'only line\n');
		const bareId = handle.replace('@span:', '');
		const resolution = await resolveSpanHandle(bareId);
		t.is(resolution.status, 'ok');
	});
});

test.serial('unknown handle resolves as unknown', async t => {
	const resolution = await resolveSpanHandle('@span:never-issued');
	t.is(resolution.status, 'unknown');
});

// ============================================================================
// Stale handle tests
// ============================================================================

test.serial('a handle whose file changed since resolves as stale', async t => {
	await withTempFile('old content\n', async path => {
		const handle = registerSpanForRange(path, 1, 1, 'old content\n');
		await writeFile(path, 'new content\n', 'utf-8');
		const resolution = await resolveSpanHandle(handle);
		t.is(resolution.status, 'stale');
	});
});

test.serial('a handle whose file was deleted resolves as file-missing', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'span-handles-'));
	const path = join(dir, 'gone.ts');
	await writeFile(path, 'content\n', 'utf-8');
	const handle = registerSpanForRange(path, 1, 1, 'content\n');
	await rm(dir, {recursive: true, force: true});

	const resolution = await resolveSpanHandle(handle);
	t.is(resolution.status, 'file-missing');
});

test.serial('a consumed handle resolves as unknown', async t => {
	await withTempFile('content\n', async path => {
		const handle = registerSpanForRange(path, 1, 1, 'content\n');
		consumeSpanHandle(handle);
		const resolution = await resolveSpanHandle(handle);
		t.is(resolution.status, 'unknown');
	});
});

// ============================================================================
// Overlapping span tests
// ============================================================================

test.serial(
	'an overlapping handle goes stale once a sibling edit changes its range',
	async t => {
		await withTempFile('one\ntwo\nthree\n', async path => {
			// Two handles over overlapping ranges, as read_file and
			// search_file_contents would both issue for the same lines.
			const wide = registerSpanForRange(path, 1, 3, 'one\ntwo\nthree\n');
			const narrow = registerSpanForRange(path, 2, 2, 'one\ntwo\nthree\n');

			// Simulate replace_span applying the wide handle's edit directly.
			await writeFile(path, 'one\nTWO-CHANGED\nthree\n', 'utf-8');

			const wideResolution = await resolveSpanHandle(wide);
			const narrowResolution = await resolveSpanHandle(narrow);
			// The wide span's own content changed too, so it is stale against
			// itself as much as the narrow one is.
			t.is(wideResolution.status, 'stale');
			t.is(narrowResolution.status, 'stale');
		});
	},
);

test.serial(
	'a sibling span outside the edited range still resolves fine',
	async t => {
		await withTempFile('one\ntwo\nthree\n', async path => {
			const line1 = registerSpanForRange(path, 1, 1, 'one\ntwo\nthree\n');
			const line3 = registerSpanForRange(path, 3, 3, 'one\ntwo\nthree\n');

			// Edit only line 2; lines 1 and 3 are untouched.
			await writeFile(path, 'one\nTWO-CHANGED\nthree\n', 'utf-8');

			t.is((await resolveSpanHandle(line1)).status, 'ok');
			t.is((await resolveSpanHandle(line3)).status, 'ok');
		});
	},
);

// ============================================================================
// Bounded growth ("compaction") tests
// ============================================================================

test.serial('evicts the oldest handle once the cap is exceeded', async t => {
	// Registration never touches disk, so a synthetic path/content pair is
	// enough to exercise the FIFO cap cheaply.
	const first = registerSpanWithContent('/dummy.ts', 1, 1, 'first');
	for (let i = 0; i < 500; i++) {
		registerSpanWithContent('/dummy.ts', 1, 1, `filler-${i}`);
	}
	const last = registerSpanWithContent('/dummy.ts', 1, 1, 'last');

	t.is((await resolveSpanHandle(first)).status, 'unknown');
	// The most recent handle still resolves (file-missing, since /dummy.ts
	// doesn't really exist — but that proves it was found in the map at all,
	// unlike the evicted one which is reported unknown before any disk access).
	t.not((await resolveSpanHandle(last)).status, 'unknown');
});

test.serial('clearSpanHandles drops every handle', async t => {
	await withTempFile('content\n', async path => {
		const handle = registerSpanForRange(path, 1, 1, 'content\n');
		clearSpanHandles();
		const resolution = await resolveSpanHandle(handle);
		t.is(resolution.status, 'unknown');
	});
});
