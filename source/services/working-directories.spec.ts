import {mkdtempSync, mkdirSync, rmSync, symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {createSessionContext, runInSessionContext} from './session-context';
import {resetSessionCwd, setProjectRoot, setSessionCwd} from './session-cwd';
import {
	addWorkingDirectory,
	getWorkingDirectories,
	resolveWorkingPath,
	assertWritablePath,
} from './working-directories';

const parent = mkdtempSync(join(tmpdir(), 'nano-roots-'));
const primary = join(parent, 'primary');
const extra = join(parent, 'extra');
const outside = join(parent, 'outside');
for (const dir of [primary, extra, outside]) mkdirSync(dir);
test.beforeEach(() => {
	resetSessionCwd();
	setProjectRoot(primary);
	setSessionCwd(primary);
});
test.after.always(() => {
	resetSessionCwd();
	rmSync(parent, {recursive: true, force: true});
});

test.serial('untrusted additions fail without changing active roots', t => {
	t.throws(
		() =>
			addWorkingDirectory({path: extra}, false, () => ({
				trusted: false,
				persisted: false,
			})),
		{message: /not trusted/},
	);
	t.is(getWorkingDirectories().length, 1);
});
test.serial(
	'trusted roots allow absolute paths, reject escapes and deduplicate',
	t => {
		addWorkingDirectory({path: extra}, true);
		addWorkingDirectory({path: extra}, true);
		t.is(getWorkingDirectories().length, 2);
		t.is(resolveWorkingPath(join(extra, 'new.txt')), join(extra, 'new.txt'));
		t.throws(() => resolveWorkingPath(join(outside, 'secret')));
		t.throws(() => resolveWorkingPath('../outside/secret'));
	},
);
test.serial(
	'read-only roots protect new files and symlink aliases even under a writable parent',
	t => {
		addWorkingDirectory({path: parent}, true);
		addWorkingDirectory({path: extra, mode: 'read-only'}, true);
		symlinkSync(extra, join(primary, 'alias'), 'dir');
		t.is(resolveWorkingPath(join(extra, 'new.txt')), join(extra, 'new.txt'));
		t.throws(() => assertWritablePath(join(extra, 'new.txt')), {
			message: /read-only/,
		});
		t.throws(() => assertWritablePath(join(primary, 'alias', 'new.txt')), {
			message: /read-only/,
		});
		t.notThrows(() => assertWritablePath(join(primary, 'new.txt')));
	},
);
test.serial('added roots remain inside their session', t => {
	const first = createSessionContext(primary);
	const second = createSessionContext(primary);
	runInSessionContext(first, () => addWorkingDirectory({path: extra}, true));
	runInSessionContext(second, () => t.is(getWorkingDirectories().length, 1));
	runInSessionContext(first, () => t.is(getWorkingDirectories().length, 2));
});

test.serial(
	'file mutation validators allow copies out of read-only roots and deny moves',
	async t => {
		const {validatePath, validatePathPair} = await import(
			'../tools/file-ops/path-validators'
		);
		addWorkingDirectory({path: extra, mode: 'read-only'}, true);
		t.false(validatePath(join(extra, 'new.txt')).valid);
		t.true(
			validatePathPair(join(extra, 'a.txt'), join(primary, 'b.txt')).valid,
		);
		t.false(
			validatePathPair(join(extra, 'a.txt'), join(primary, 'b.txt'), true)
				.valid,
		);
		t.false(
			validatePathPair(join(primary, 'b.txt'), join(extra, 'a.txt')).valid,
		);
	},
);

test.serial(
	'discovery searches all roots using each roots ignore rules',
	async t => {
		const {writeFileSync} = await import('node:fs');
		const {findFilesTool} = await import('../tools/find-files');
		const {searchFileContentsTool} = await import(
			'../tools/search-file-contents'
		);
		const {getAllFiles} = await import('../input/file-autocomplete');
		writeFileSync(join(primary, 'primary.txt'), 'multi-root needle');
		writeFileSync(join(extra, 'extra.txt'), 'multi-root needle');
		writeFileSync(join(extra, 'ignored.txt'), 'multi-root needle');
		writeFileSync(join(extra, '.nanocoderignore'), 'ignored.txt\n');
		addWorkingDirectory({path: extra}, true);
		const options = {toolCallId: 'test', messages: []};
		const found = await findFilesTool.tool.execute!(
			{pattern: '*.txt'},
			options,
		);
		t.true(String(found).includes(join(extra, 'extra.txt')));
		t.false(String(found).includes('ignored.txt'));
		const searched = await searchFileContentsTool.tool.execute!(
			{query: 'multi-root needle'},
			options,
		);
		t.true(String(searched).includes(join(extra, 'extra.txt')));
		t.false(String(searched).includes('ignored.txt'));
		const completed = await getAllFiles(primary);
		t.true(completed.includes(join(extra, 'extra.txt')));
		t.false(completed.some(file => file.endsWith('ignored.txt')));
	},
);

test.serial(
	'mentions fail safely outside active roots and read added files',
	async t => {
		const {writeFileSync} = await import('node:fs');
		const {loadFileContent} = await import('../input/file-content-loader');
		writeFileSync(join(extra, 'mention.txt'), 'reference');
		const denied = await loadFileContent(join(extra, 'mention.txt'));
		t.false(denied.success);
		addWorkingDirectory({path: extra, mode: 'read-only'}, true);
		const loaded = await loadFileContent(join(extra, 'mention.txt'));
		t.true(loaded.success);
		t.true(loaded.content?.includes('reference'));
	},
);

test.serial(
	'directory listing and scoped search follow symlinks into an explicitly added root',
	async t => {
		const {writeFileSync} = await import('node:fs');
		const {listDirectoryTool} = await import('../tools/list-directory');
		const {searchFileContentsTool} = await import(
			'../tools/search-file-contents'
		);
		writeFileSync(join(extra, 'alias.txt'), 'alias needle');
		symlinkSync(extra, join(primary, 'search-alias'), 'dir');
		addWorkingDirectory({path: extra}, true);
		const options = {toolCallId: 'test', messages: []};
		const listing = await listDirectoryTool.tool.execute!(
			{path: 'search-alias'},
			options,
		);
		t.true(String(listing).includes('alias.txt'));
		const searched = await searchFileContentsTool.tool.execute!(
			{query: 'alias needle', path: 'search-alias'},
			options,
		);
		t.true(String(searched).includes('alias.txt'));
	},
);

test.serial(
	'nested roots apply their own ignores instead of leaking through a parent scan',
	async t => {
		const {writeFileSync} = await import('node:fs');
		const {findFilesTool} = await import('../tools/find-files');
		const {searchFileContentsTool} = await import(
			'../tools/search-file-contents'
		);
		const {getAllFiles, clearFileListCache} = await import(
			'../input/file-autocomplete'
		);
		const nested = join(primary, 'nested');
		mkdirSync(nested);
		writeFileSync(join(nested, '.nanocoderignore'), 'hidden.txt\n');
		writeFileSync(join(nested, 'hidden.txt'), 'nested needle');
		writeFileSync(join(nested, 'visible.txt'), 'nested needle');
		addWorkingDirectory({path: nested, mode: 'read-only'}, true);
		const options = {toolCallId: 'test', messages: []};
		const found = String(
			await findFilesTool.tool.execute!({pattern: '*.txt'}, options),
		);
		t.false(found.includes('hidden.txt'));
		t.true(found.includes('visible.txt'));
		const searched = String(
			await searchFileContentsTool.tool.execute!(
				{query: 'nested needle'},
				options,
			),
		);
		t.false(searched.includes('hidden.txt'));
		t.true(searched.includes('visible.txt'));
		clearFileListCache();
		const completed = await getAllFiles(primary);
		t.false(completed.some(file => file.endsWith('hidden.txt')));
		t.true(completed.some(file => file.endsWith('visible.txt')));
	},
);

test.serial(
	'nested roots do not consume the parent search limit or leak through recursive listing',
	async t => {
		const {writeFileSync} = await import('node:fs');
		const {findFilesTool} = await import('../tools/find-files');
		const {searchFileContentsTool} = await import(
			'../tools/search-file-contents'
		);
		const {listDirectoryTool} = await import('../tools/list-directory');
		const nested = join(primary, 'a');
		mkdirSync(nested);
		writeFileSync(join(nested, '.nanocoderignore'), '*.txt\n');
		for (const file of ['one.txt', 'two.txt'])
			writeFileSync(join(nested, file), 'budget needle');
		writeFileSync(join(primary, 'z.txt'), 'budget needle');
		addWorkingDirectory({path: nested}, true);
		const options = {toolCallId: 'test', messages: []};
		const searched = String(
			await searchFileContentsTool.tool.execute!(
				{query: 'budget needle', maxResults: 1},
				options,
			),
		);
		t.true(searched.includes('z.txt'));
		const found = String(
			await findFilesTool.tool.execute!(
				{pattern: 'z.txt', maxResults: 1},
				options,
			),
		);
		t.true(found.includes('z.txt'));
		const listed = String(
			await listDirectoryTool.tool.execute!(
				{path: primary, recursive: true},
				options,
			),
		);
		t.false(listed.includes('one.txt'));
		t.false(listed.includes('two.txt'));
	},
);

test.serial(
	'explicit search of a parent includes nested roots with their own ignores',
	async t => {
		const {writeFileSync} = await import('node:fs');
		const {searchFileContentsTool} = await import(
			'../tools/search-file-contents'
		);
		const nested = join(primary, 'scoped');
		mkdirSync(nested);
		writeFileSync(join(nested, '.nanocoderignore'), 'hidden.txt\n');
		writeFileSync(join(nested, 'hidden.txt'), 'scoped needle');
		writeFileSync(join(nested, 'visible.txt'), 'scoped needle');
		addWorkingDirectory({path: nested}, true);
		const options = {toolCallId: 'test', messages: []};
		const searched = String(
			await searchFileContentsTool.tool.execute!(
				{query: 'scoped needle', path: primary},
				options,
			),
		);
		t.true(searched.includes('visible.txt'));
		t.false(searched.includes('hidden.txt'));
	},
);

test.serial(
	'adding the primary root does not duplicate it or upgrade read-only access',
	t => {
		addWorkingDirectory({path: primary}, true);
		t.is(getWorkingDirectories().length, 1);
		addWorkingDirectory({path: primary, mode: 'read-only'}, true);
		const repeated = addWorkingDirectory({path: primary}, true);
		t.is(repeated.mode, 'read-only');
		t.deepEqual(getWorkingDirectories(), [{path: primary, mode: 'read-only'}]);
		t.throws(() => assertWritablePath(join(primary, 'new.txt')), {
			message: /read-only/,
		});
	},
);
