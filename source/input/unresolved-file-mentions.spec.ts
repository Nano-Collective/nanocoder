import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearFileListCache} from './file-autocomplete';
import {
	buildUnresolvedMentionNote,
	findUnresolvedFileMentions,
	formatUnresolvedMentionWarning,
	parseRawFileMentions,
} from './unresolved-file-mentions';

console.log('\nunresolved-file-mentions.spec.ts');

function inTempProject(t: {teardown: (fn: () => void) => void}) {
	const dir = mkdtempSync(join(tmpdir(), 'unresolved-mentions-'));
	mkdirSync(join(dir, 'src'), {recursive: true});
	writeFileSync(join(dir, 'src', 'app.tsx'), 'export const App = () => null;\n');
	writeFileSync(join(dir, 'notes.txt'), 'notes\n');
	const cwd = process.cwd();
	process.chdir(dir);
	clearFileListCache();
	t.teardown(() => {
		process.chdir(cwd);
		clearFileListCache();
		rmSync(dir, {recursive: true, force: true});
	});
	return dir;
}

test('parses file mentions and strips prose punctuation', t => {
	const mentions = parseRawFileMentions(
		'Check @src/app.tsx:10-20 and @old/path.ts, then @.env.',
	);

	t.deepEqual(
		mentions.map(mention => mention.rawText),
		['@src/app.tsx:10-20', '@old/path.ts', '@.env'],
	);
	t.deepEqual(mentions[0]?.lineRange, {start: 10, end: 20});
	t.is(mentions[1]?.filePath, 'old/path.ts');
});

test('ignores emails, existing placeholders, scoped packages and bare handles', t => {
	t.deepEqual(
		parseRawFileMentions(
			'email user@example.com, keep [@src/app.tsx], upgrade @types/node and @media rules',
		),
		[],
	);
});

test.serial('reports a missing file with a close suggestion', async t => {
	const dir = inTempProject(t);

	const unresolved = await findUnresolvedFileMentions('read @src/app.tsxx', dir);

	t.is(unresolved.length, 1);
	t.is(unresolved[0]?.rawText, '@src/app.tsxx');
	t.is(unresolved[0]?.reason, 'file not found');
	t.is(unresolved[0]?.suggestion, 'src/app.tsx');
});

test.serial('resolves existing files, line ranges and placeholders', async t => {
	const dir = inTempProject(t);

	t.deepEqual(
		await findUnresolvedFileMentions(
			'read @src/app.tsx:1 and also [@src/app.tsx]',
			dir,
		),
		[],
	);
});

test.serial('reports a directory mention as not a file', async t => {
	const dir = inTempProject(t);

	const unresolved = await findUnresolvedFileMentions('open @src/', dir);

	t.is(unresolved.length, 1);
	t.is(unresolved[0]?.reason, 'is a directory, not a file');
});

test('formats a one-line warning and a model note', t => {
	const mentions = [
		{
			rawText: '@src/app.tsxx',
			filePath: 'src/app.tsxx',
			reason: 'file not found',
			suggestion: 'src/app.tsx',
		},
	];

	t.is(
		formatUnresolvedMentionWarning(mentions),
		'Could not attach @src/app.tsxx: file not found (did you mean src/app.tsx?). Press Enter again to send anyway.',
	);

	const note = buildUnresolvedMentionNote(mentions);
	t.true(note.includes('could not be attached'));
	t.true(note.includes('- @src/app.tsxx: file not found'));
	t.true(note.includes('Do not claim to have read them'));
});
