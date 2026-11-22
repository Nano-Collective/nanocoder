import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {
	EditorExitError,
	buildEditorCommand,
	editorArgs,
	getEditor,
	openInEditor,
} from './editor';

test.serial('editor arguments and literal paths survive without shell expansion', t => {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-editor-'));
	const saved = {...process.env};
	try {
		const script = join(dir, 'fake editor.cjs');
		const output = join(dir, 'args.json');
		writeFileSync(script, 'require("node:fs").writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))');
		process.env.EDITOR = `"${process.execPath}" "${script}" "${output}" --wait`;
		delete process.env.VISUAL;
		const path = join(dir, 'a$(touch pwned)`echo bad`$HOME.json');
		openInEditor(path);
		t.deepEqual(JSON.parse(readFileSync(output, 'utf8')), ['--wait', path]);
	} finally {
		process.env = saved;
		rmSync(dir, {recursive: true, force: true});
	}
});

test.serial('VISUAL takes precedence over EDITOR', t => {
	const saved = {...process.env};
	try {
		process.env.VISUAL = 'visual --wait';
		process.env.EDITOR = 'editor';
		t.is(getEditor(), 'visual --wait');
	} finally {
		process.env = saved;
	}
});

test.serial('missing editors report the spawn error and restore raw mode', t => {
	const saved = {...process.env};
	const original = process.stdin.setRawMode;
	const raw = process.stdin.isRaw;
	const modes: boolean[] = [];
	try {
		process.env.VISUAL = 'nanocoder-editor-that-does-not-exist';
		process.stdin.isRaw = true;
		process.stdin.setRawMode = mode => { modes.push(mode); return process.stdin; };
		t.throws(() => openInEditor('/tmp/config.json'), {message: /ENOENT/});
		t.deepEqual(modes, [false, true]);
	} finally {
		process.env = saved;
		process.stdin.setRawMode = original;
		process.stdin.isRaw = raw;
	}
});

test.serial('non-zero editor exit throws EditorExitError, not a launch error', t => {
	const saved = {...process.env};
	try {
		process.env.EDITOR = `"${process.execPath}" -e "process.exit(1)"`;
		delete process.env.VISUAL;
		const error = t.throws(() => openInEditor('/tmp/config.json'), {
			instanceOf: EditorExitError,
		});
		t.regex(error.message, /^Editor exited with status 1/);
	} finally {
		process.env = saved;
	}
});

test.serial('launch failures are not EditorExitError', t => {
	const saved = {...process.env};
	try {
		process.env.VISUAL = 'nanocoder-editor-that-does-not-exist';
		const error = t.throws(() => openInEditor('/tmp/config.json'));
		t.false(error instanceof EditorExitError);
	} finally {
		process.env = saved;
	}
});

test('editor command quoting preserves arguments and Windows paths', t => {
 t.deepEqual(editorArgs('code --wait'), ['code', '--wait']);
 t.deepEqual(editorArgs("'editor path' --name='two words' ''"), ['editor path', '--name=two words', '']);
 t.deepEqual(editorArgs(String.raw`"C:\Program Files\Editor\editor.exe" --wait`), [String.raw`C:\Program Files\Editor\editor.exe`, '--wait']);
 t.throws(() => editorArgs('"unfinished'), {message: /Unclosed quote/});
 t.throws(() => editorArgs('  '), {message: /Empty editor/});
});

test('Windows: PATHEXT-resolved .cmd shim runs through cmd.exe with quoting', t => {
	const r = buildEditorCommand(
		'code',
		['--wait', 'C:\\my dir\\a&b.json'],
		'win32',
		() => 'C:\\bin\\code.cmd',
	);
	t.is(r.verbatim, true);
	t.deepEqual(r.args.slice(0, 3), ['/d', '/s', '/c']);
	t.is(
		r.args[3],
		'""C:\\bin\\code.cmd" "--wait" "C:\\my dir\\a&b.json""',
	);
});

test('Windows: .exe is spawned directly and .cmd with a quote is refused', t => {
	t.deepEqual(
		buildEditorCommand('notepad', ['f.json'], 'win32', () => 'C:\\w\\notepad.exe'),
		{command: 'C:\\w\\notepad.exe', args: ['f.json'], verbatim: false},
	);
	t.throws(() =>
		buildEditorCommand('code', ['a"b.json'], 'win32', () => 'C:\\bin\\code.cmd'),
	);
	t.deepEqual(buildEditorCommand('nano', ['f'], 'linux'), {
		command: 'nano',
		args: ['f'],
		verbatim: false,
	});
});
