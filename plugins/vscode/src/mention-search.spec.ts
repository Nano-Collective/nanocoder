import test from 'ava';
import {
	MentionSearchDeps,
	searchMentions,
	toGlobFragment,
	toLiteralQuery,
	toRelPath,
} from './mention-search';

interface FakeWorkspace {
	root?: string;
	editors?: string[];
	/** Absolute paths returned for a glob, keyed by the glob itself. */
	files?: Record<string, string[]>;
	caseInsensitiveFs?: boolean;
}

/** Records every glob asked for, so tests can assert on search behaviour. */
function makeDeps(workspace: FakeWorkspace = {}) {
	const globs: string[] = [];
	const deps: MentionSearchDeps = {
		workspaceRoot: workspace.root ?? '/repo',
		openEditors: () => workspace.editors ?? [],
		findFiles: async glob => {
			globs.push(glob);
			return workspace.files?.[glob] ?? [];
		},
		// Pinned rather than inherited from the host, so the dedupe assertions
		// mean the same thing on Linux CI and a Windows dev box.
		caseInsensitiveFs: workspace.caseInsensitiveFs ?? true,
	};
	return { deps, globs };
}

// ── Open editors ──────────────────────────────────────────

test('searchMentions - bare @ returns open editors without searching disk', async t => {
	const { deps, globs } = makeDeps({
		editors: ['/repo/src/app.ts', '/repo/README.md'],
	});

	const items = await searchMentions('', deps);

	t.deepEqual(
		items.map(i => i.relPath),
		['README.md', 'src/app.ts'],
	);
	t.true(items.every(i => i.isEditor));
	t.deepEqual(globs, [], 'a bare @ must not hit the filesystem');
});

test('searchMentions - open editors are filtered by the query', async t => {
	const { deps } = makeDeps({
		editors: ['/repo/src/app.ts', '/repo/README.md'],
	});

	const items = await searchMentions('read', deps);

	t.deepEqual(
		items.map(i => i.relPath),
		['README.md'],
	);
});

test('searchMentions - matching is case-insensitive', async t => {
	const { deps } = makeDeps({ editors: ['/repo/src/AppShell.ts'] });

	const items = await searchMentions('appshell', deps);

	t.is(items.length, 1);
	t.is(items[0].name, 'AppShell.ts');
});

// ── File search ───────────────────────────────────────────

test('searchMentions - finds files by basename', async t => {
	const { deps, globs } = makeDeps({
		files: { '**/*mention*': ['/repo/src/mention-search.ts'] },
	});

	const items = await searchMentions('mention', deps);

	t.deepEqual(
		items.map(i => i.relPath),
		['src/mention-search.ts'],
	);
	t.is(items[0].kind, 'file');
	t.false(items[0].isEditor);
	t.true(globs.includes('**/*mention*'));
});

test('searchMentions - an open file is not duplicated by the file search', async t => {
	const { deps } = makeDeps({
		editors: ['/repo/src/app.ts'],
		files: { '**/*app*': ['/repo/src/app.ts', '/repo/src/app-util.ts'] },
	});

	const items = await searchMentions('app', deps);

	t.is(items.filter(i => i.relPath === 'src/app.ts').length, 1);
	t.true(
		items.find(i => i.relPath === 'src/app.ts')?.isEditor,
		'the editor entry must win the dedupe',
	);
	t.is(items.length, 2);
});

test('searchMentions - a slash query matches the path, not the basename', async t => {
	const { deps, globs } = makeDeps({
		files: {
			'**/*app*': ['/repo/src/app.ts', '/repo/test/app.ts'],
		},
	});

	const items = await searchMentions('src/app', deps);

	t.deepEqual(
		items.map(i => i.relPath),
		['src/app.ts'],
		'test/app.ts matches the basename but not the path fragment',
	);
	t.true(
		globs.includes('**/*app*'),
		'the glob is built from the last segment only',
	);
});

// ── Folders ───────────────────────────────────────────────

test('searchMentions - derives folders from files beneath a matching directory', async t => {
	const { deps, globs } = makeDeps({
		files: {
			'**/*components*/**': [
				'/repo/src/components/Button.tsx',
				'/repo/src/components/forms/Input.tsx',
			],
		},
	});

	const items = await searchMentions('components', deps);

	t.deepEqual(
		items.map(i => i.relPath),
		['src/components'],
	);
	t.is(items[0].kind, 'folder');
	t.true(globs.includes('**/*components*/**'));
});

test('searchMentions - a folder is listed once regardless of how many files it holds', async t => {
	const { deps } = makeDeps({
		files: {
			'**/*util*/**': [
				'/repo/src/utils/a.ts',
				'/repo/src/utils/b.ts',
				'/repo/src/utils/c.ts',
			],
		},
	});

	const items = await searchMentions('util', deps);

	t.is(items.filter(i => i.relPath === 'src/utils').length, 1);
});

// ── Ranking ───────────────────────────────────────────────

test('searchMentions - exact basename outranks a substring match', async t => {
	const { deps } = makeDeps({
		files: {
			'**/*app*': ['/repo/src/app-controller.ts', '/repo/src/app'],
		},
	});

	const items = await searchMentions('app', deps);

	t.is(items[0].relPath, 'src/app');
});

test('searchMentions - an open file outranks an equally matching closed file', async t => {
	const { deps } = makeDeps({
		editors: ['/repo/deeply/nested/app.ts'],
		files: {
			'**/*app*': ['/repo/app.ts', '/repo/deeply/nested/app.ts'],
		},
	});

	const items = await searchMentions('app', deps);

	t.is(
		items[0].relPath,
		'deeply/nested/app.ts',
		'the editor bonus must beat the shorter-path tiebreak',
	);
});

test('searchMentions - shallower paths win ties', async t => {
	const { deps } = makeDeps({
		files: {
			'**/*app*': ['/repo/a/b/c/app.ts', '/repo/app.ts'],
		},
	});

	const items = await searchMentions('app', deps);

	t.deepEqual(
		items.map(i => i.relPath),
		['app.ts', 'a/b/c/app.ts'],
	);
});

// ── Robustness ────────────────────────────────────────────

test('toGlobFragment - widens glob metacharacters instead of passing them through', t => {
	t.is(toGlobFragment('a{b,c}d'), 'a*b,c*d');
	t.is(toGlobFragment('a*b'), 'a*b');
	t.is(toGlobFragment('[abc]'), '*abc*');
	t.is(toGlobFragment('a**b'), 'a*b');
});

test('searchMentions - a query full of glob metacharacters does not throw', async t => {
	const { deps, globs } = makeDeps();

	await t.notThrowsAsync(searchMentions('{a,b}[c]*?', deps));
	t.false(
		globs.some(g => g.includes('{') || g.includes('[')),
		'metacharacters must not reach findFiles',
	);
});

test('searchMentions - an over-long query is rejected without searching', async t => {
	const { deps, globs } = makeDeps({ editors: ['/repo/a.ts'] });

	const items = await searchMentions('x'.repeat(500), deps);

	t.deepEqual(items, []);
	t.deepEqual(globs, []);
});

test('searchMentions - respects the result limit', async t => {
	const paths = Array.from({ length: 50 }, (_, i) => `/repo/app${i}.ts`);
	const { deps } = makeDeps({ files: { '**/*app*': paths } });

	const items = await searchMentions('app', deps, 5);

	t.is(items.length, 5);
});

test('searchMentions - a search failure propagates rather than returning junk', async t => {
	const deps: MentionSearchDeps = {
		workspaceRoot: '/repo',
		openEditors: () => [],
		findFiles: async () => {
			throw new Error('workspace unavailable');
		},
	};

	// The caller in chat-webview-provider catches this and answers with an
	// empty result set so the webview clears its in-flight state.
	await t.throwsAsync(searchMentions('app', deps), {
		message: 'workspace unavailable',
	});
});

// ── Path handling ─────────────────────────────────────────

test('toRelPath - normalizes Windows separators and strips the root', t => {
	t.is(
		toRelPath('C:\\work\\repo\\src\\app.ts', 'C:\\work\\repo'),
		'src/app.ts',
	);
});

test('toRelPath - tolerates drive-letter case differences', t => {
	t.is(toRelPath('c:\\work\\repo\\src\\app.ts', 'C:\\work\\repo'), 'src/app.ts');
});

test('toRelPath - falls back to the absolute path outside the workspace', t => {
	t.is(toRelPath('/elsewhere/notes.md', '/repo'), '/elsewhere/notes.md');
});

test('searchMentions - files outside the workspace stay usable', async t => {
	const { deps } = makeDeps({ editors: ['/elsewhere/notes.md'] });

	const items = await searchMentions('notes', deps);

	t.is(items.length, 1);
	t.is(items[0].path, '/elsewhere/notes.md');
	t.is(items[0].relPath, '/elsewhere/notes.md');
	t.is(items[0].name, 'notes.md');
});

test('searchMentions - Windows workspaces produce forward-slash relative paths', async t => {
	const { deps } = makeDeps({
		root: 'C:\\work\\repo',
		files: { '**/*app*': ['C:\\work\\repo\\src\\app.ts'] },
	});

	const items = await searchMentions('app', deps);

	t.is(items[0].relPath, 'src/app.ts');
	t.is(items[0].name, 'app.ts');
	t.is(items[0].path, 'C:\\work\\repo\\src\\app.ts', 'chips need the OS path');
});

// ── Glob-only queries ─────────────────────────

test('toLiteralQuery - drops glob metacharacters', t => {
	t.is(toLiteralQuery('**'), '');
	t.is(toLiteralQuery('src/*.ts'), 'src/.ts');
});

/**
 * Regression: `@**` widened to a match-everything glob, ran a full workspace
 * scan, and then filtered every result away against the raw `**` needle —
 * maximum cost for guaranteed zero results.
 */
test('searchMentions - a glob-only query does not scan the workspace', async t => {
	const { deps, globs } = makeDeps({
		editors: ['/repo/src/app.ts'],
		files: { '**/**': ['/repo/src/app.ts'] },
	});

	const items = await searchMentions('**', deps);

	t.deepEqual(globs, [], 'a query with no literal characters must not hit disk');
	t.deepEqual(
		items.map(i => i.relPath),
		['src/app.ts'],
		'falls back to open editors, as a bare @ does',
	);
});

test('searchMentions - a query mixing globs and literals still searches', async t => {
	// The user's own `*` survives into the glob, so the key is `**/**app**`.
	const { deps, globs } = makeDeps({
		files: { '**/**app**': ['/repo/src/app.ts'] },
	});

	const items = await searchMentions('*app*', deps);

	t.true(globs.length > 0, 'there is a literal to search for');
	t.deepEqual(
		items.map(i => i.relPath),
		['src/app.ts'],
		'the metacharacters must not defeat the result filter',
	);
});

// ── Case-sensitive filesystems ──────────────────

/**
 * Regression: the dedupe key was `absPath.toLowerCase()` unconditionally, so on
 * Linux two genuinely distinct siblings collapsed into one and the second
 * silently vanished from the dropdown.
 */
test('searchMentions - case-sensitive siblings both survive the dedupe', async t => {
	const { deps } = makeDeps({
		caseInsensitiveFs: false,
		files: { '**/*app*': ['/repo/src/App.ts', '/repo/src/app.ts'] },
	});

	const items = await searchMentions('app', deps);

	t.deepEqual(
		items.map(i => i.relPath).sort(),
		['src/App.ts', 'src/app.ts'],
	);
});

test('searchMentions - case-insensitive filesystems still collapse them', async t => {
	const { deps } = makeDeps({
		caseInsensitiveFs: true,
		files: { '**/*app*': ['/repo/src/App.ts', '/repo/src/app.ts'] },
	});

	const items = await searchMentions('app', deps);

	t.is(items.length, 1, 'one file on disk means one suggestion');
});
