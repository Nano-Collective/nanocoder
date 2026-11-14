import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {editorArgs, getEditor, openInEditor} from './editor';

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


test('editor command quoting preserves arguments and Windows paths', t => {
 t.deepEqual(editorArgs('code --wait'), ['code', '--wait']);
 t.deepEqual(editorArgs("'editor path' --name='two words' ''"), ['editor path', '--name=two words', '']);
 t.deepEqual(editorArgs(String.raw`"C:\Program Files\Editor\editor.exe" --wait`), [String.raw`C:\Program Files\Editor\editor.exe`, '--wait']);
 t.throws(() => editorArgs('"unfinished'), {message: /Unclosed quote/});
 t.throws(() => editorArgs('  '), {message: /Empty editor/});
});
