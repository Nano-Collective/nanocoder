import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {join, relative} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '../../config/themes.js';
import {ThemeContext} from '../../hooks/useTheme.js';
import {resolveToolApproval} from '../approval-policy.js';
import {clearReadTracker, markFileSeen} from '../../utils/read-tracker.js';
import {diffEditTool, parseDiffEditBlocks} from './diff-edit.js';

console.log(`\ndiff-edit.spec.tsx - ${React.version}`);

function TestThemeProvider({children}: {children: React.ReactNode}) {
	const themeContextValue = {
		currentTheme: 'tokyo-night' as const,
		colors: themes['tokyo-night'].colors,
		setCurrentTheme: () => {},
	};

	return (
		<ThemeContext.Provider value={themeContextValue}>
			{children}
		</ThemeContext.Provider>
	);
}

let testDir: string;

test.beforeEach(async () => {
	testDir = await mkdtemp(join(process.cwd(), '.diff-edit-test-'));
	clearReadTracker();
});

test.afterEach(async () => {
	if (testDir) {
		await rm(testDir, {recursive: true, force: true});
	}
});

async function createTestFile(
	filename: string,
	content: string,
): Promise<string> {
	const filePath = join(testDir, filename);
	await writeFile(filePath, content, 'utf-8');
	return filePath;
}

function projectRelativePath(filePath: string): string {
	return relative(process.cwd(), filePath);
}

async function executeDiffEdit(args: {
	path: string;
	diff: string;
}): Promise<string> {
	// biome-ignore lint/suspicious/noExplicitAny: Tool internals require any
	return await (diffEditTool.tool as any).execute(args, {
		toolCallId: 'test',
		messages: [],
	});
}

const searchMarker = '<'.repeat(7) + ' SEARCH';
const separatorMarker = '='.repeat(7);
const replaceMarker = '>'.repeat(7) + ' REPLACE';

function diffBlock(search: string, replace: string): string {
	return [
		searchMarker,
		search,
		separatorMarker,
		replace,
		replaceMarker,
	].join('\n');
}

const sampleDiff = diffBlock('const oldValue = 1;', 'const newValue = 2;');

test('diff_edit requires approval in normal mode', async t => {
	t.true(
		await resolveToolApproval(diffEditTool.name, diffEditTool, {
			path: 'test.ts',
			diff: sampleDiff,
		}, {mode: 'normal'}),
	);
});

test('parseDiffEditBlocks parses a single search replace block', t => {
	t.deepEqual(parseDiffEditBlocks(sampleDiff), [
		{search: 'const oldValue = 1;', replace: 'const newValue = 2;'},
	]);
});

test('parseDiffEditBlocks parses multiple blocks', t => {
	const diff = [diffBlock('alpha', 'beta'), diffBlock('gamma', 'delta')].join(
		'\n\n',
	);

	t.deepEqual(parseDiffEditBlocks(diff), [
		{search: 'alpha', replace: 'beta'},
		{search: 'gamma', replace: 'delta'},
	]);
});

test('parseDiffEditBlocks rejects malformed input with missing separator', t => {
	t.throws(
		() =>
			parseDiffEditBlocks([searchMarker, 'old', replaceMarker].join('\n')),
		{message: /missing ======= separator/i},
	);
});

test('parseDiffEditBlocks rejects unterminated blocks', t => {
	t.throws(
		() =>
			parseDiffEditBlocks(
				[searchMarker, 'old', separatorMarker, 'new'].join('\n'),
			),
		{message: /missing >>>>>>> REPLACE/i},
	);
});

test('diff_edit applies a single block', async t => {
	const filePath = await createTestFile(
		'test.ts',
		'const oldValue = 1;\nconsole.log(oldValue);\n',
	);

	const result = await executeDiffEdit({
		path: filePath,
		diff: sampleDiff,
	});

	t.is(
		await readFile(filePath, 'utf-8'),
		'const newValue = 2;\nconsole.log(oldValue);\n',
	);
	t.regex(result, /Successfully applied 1 diff block/);
});

test('diff_edit applies multiple blocks atomically', async t => {
	const filePath = await createTestFile('test.ts', 'alpha\ngamma\n');

	const result = await executeDiffEdit({
		path: filePath,
		diff: [diffBlock('alpha', 'beta'), diffBlock('gamma', 'delta')].join('\n'),
	});

	t.is(await readFile(filePath, 'utf-8'), 'beta\ndelta\n');
	t.regex(result, /Successfully applied 2 diff blocks/);
});

test('diff_edit rejects duplicate search blocks and leaves file unchanged', async t => {
	const filePath = await createTestFile('test.ts', 'alpha\n');

	await t.throwsAsync(
		async () => {
			await executeDiffEdit({
				path: filePath,
				diff: [diffBlock('alpha', 'alphaX'), diffBlock('alpha', 'beta')].join(
					'\n',
				),
			});
		},
		{message: /Search block 2 duplicates an earlier search block/},
	);

	t.is(await readFile(filePath, 'utf-8'), 'alpha\n');
});

test('diff_edit returns bounded context around the changed region', async t => {
	const filePath = await createTestFile(
		'large-context.txt',
		Array.from({length: 100}, (_, index) => `line ${index + 1}`).join('\n'),
	);

	const result = await executeDiffEdit({
		path: filePath,
		diff: diffBlock('line 50', 'changed line 50'),
	});

	t.regex(result, /Successfully applied 1 diff block/);
	t.regex(result, /Updated file context \(lines 47-53 of 100\)/);
	t.true(result.includes('[... lines 1-46 omitted ...]'));
	t.true(result.includes('  47: line 47'));
	t.true(result.includes('  50: changed line 50'));
	t.true(result.includes('  53: line 53'));
	t.true(result.includes('[... lines 54-100 omitted ...]'));
	t.false(result.includes('  46: line 46'));
	t.false(result.includes('  54: line 54'));
});

test('diff_edit caps previews for unusually large changed lines', async t => {
	const filePath = await createTestFile('long-line.txt', 'before\ntarget\nafter');
	const replacement = `replacement-start-${'x'.repeat(8000)}-replacement-end`;

	const result = await executeDiffEdit({
		path: filePath,
		diff: diffBlock('target', replacement),
	});

	t.true(result.length <= 4000);
	t.true(result.includes('replacement-start-'));
	t.true(result.includes('-replacement-end'));
	t.regex(result, /preview truncated/i);
});

test('diff_edit includes each separated changed region without middle-file noise', async t => {
	const filePath = await createTestFile(
		'multiple-regions.txt',
		Array.from(
			{length: 100},
			(_, index) => `line ${String(index + 1).padStart(3, '0')}`,
		).join('\n'),
	);

	const result = await executeDiffEdit({
		path: filePath,
		diff: [
			diffBlock('line 090', 'changed line 090'),
			diffBlock('line 010', 'changed line 010'),
		].join('\n\n'),
	});

	t.regex(result, /Updated file context \(lines 7-13 of 100\)/);
	t.regex(result, /Updated file context \(lines 87-93 of 100\)/);
	t.true(result.includes('Changed regions: lines 10, 90.'));
	t.true(result.includes('[... lines 1-6 omitted ...]'));
	t.true(result.includes('[... lines 14-86 omitted ...]'));
	t.true(result.includes('[... lines 94-100 omitted ...]'));
	t.false(result.includes('[... lines 14-100 omitted ...]'));
	t.false(result.includes('[... lines 1-86 omitted ...]'));
	t.true(result.includes('  10: changed line 010'));
	t.true(result.includes('  90: changed line 090'));
	t.false(result.includes('  50: line 050'));
});

test('diff_edit keeps a summary of every changed region when the preview is capped', async t => {
	const filePath = await createTestFile(
		'capped-multiple-regions.txt',
		Array.from(
			{length: 100},
			(_, index) => `line ${String(index + 1).padStart(3, '0')}`,
		).join('\n'),
	);
	const largeReplacement = (lineNumber: number) =>
		`changed line ${lineNumber}-${'x'.repeat(3000)}`;

	const result = await executeDiffEdit({
		path: filePath,
		diff: [
			diffBlock('line 010', largeReplacement(10)),
			diffBlock('line 050', largeReplacement(50)),
			diffBlock('line 090', largeReplacement(90)),
		].join('\n\n'),
	});

	t.true(result.length <= 4000);
	t.true(result.includes('Changed regions: lines 10, 50, 90.'));
	t.regex(result, /preview truncated/i);
});

test('diff_edit rejects missing search content and leaves file unchanged', async t => {
	const filePath = await createTestFile('test.ts', 'alpha\ngamma\n');

	await t.throwsAsync(
		async () => {
			await executeDiffEdit({
				path: filePath,
				diff: [diffBlock('alpha', 'beta'), diffBlock('missing', 'delta')].join(
					'\n',
				),
			});
		},
		{message: /Search block 2 was not found/},
	);

	t.is(await readFile(filePath, 'utf-8'), 'alpha\ngamma\n');
});

test('diff_edit rejects ambiguous search content', async t => {
	const filePath = await createTestFile('test.ts', 'same\nsame\n');

	await t.throwsAsync(
		async () => {
			await executeDiffEdit({
				path: filePath,
				diff: diffBlock('same', 'changed'),
			});
		},
		{message: /Search block 1 matched 2 times/},
	);
});

test('diff_edit validator rejects empty path', async t => {
	const validator = diffEditTool.validator;
	if (!validator) {
		t.fail('diff_edit validator not defined');
		return;
	}

	const result = await validator({path: '', diff: sampleDiff});

	t.false(result.valid);
	if (!result.valid) t.regex(result.error, /Invalid file path/);
});

test('diff_edit validator rejects unread files', async t => {
	const validator = diffEditTool.validator;
	if (!validator) {
		t.fail('diff_edit validator not defined');
		return;
	}
	const filePath = await createTestFile('test.ts', 'const oldValue = 1;\n');

	const result = await validator({
		path: projectRelativePath(filePath),
		diff: sampleDiff,
	});

	t.false(result.valid);
	if (!result.valid) t.regex(result.error, /must read/);
});

test('diff_edit validator accepts a unique block after file is read', async t => {
	const validator = diffEditTool.validator;
	if (!validator) {
		t.fail('diff_edit validator not defined');
		return;
	}
	const filePath = await createTestFile('test.ts', 'const oldValue = 1;\n');
	markFileSeen(filePath);

	const result = await validator({
		path: projectRelativePath(filePath),
		diff: sampleDiff,
	});

	t.deepEqual(result, {valid: true});
});

test('diff_edit formatter renders a preview', async t => {
	const formatter = diffEditTool.formatter;
	if (!formatter) {
		t.fail('diff_edit formatter not defined');
		return;
	}

	const preview = await formatter({path: 'test.ts', diff: sampleDiff});
	const {lastFrame} = render(
		<TestThemeProvider>{preview}</TestThemeProvider>,
	);

	t.regex(lastFrame()!, /diff_edit/);
	t.regex(lastFrame()!, /test\.ts/);
	t.regex(lastFrame()!, /const oldValue/);
	t.regex(lastFrame()!, /const newValue/);
});

test('diff_edit description tells models not to wrap diff in code fences', t => {
	t.regex(
		diffEditTool.tool.description,
		/do not wrap.*code fence|code fence.*do not wrap/i,
	);
});

// `$$`, `$&`, "$`" and `$'` are substitution tokens to String.prototype.replace
// but ordinary characters in the shell scripts and CI YAML models edit.
test('diff_edit writes $ substitution tokens literally', async t => {
	const filePath = await createTestFile(
		'dollars.sh',
		'#!/bin/sh\necho "old"\nexit 0\n',
	);
	const replacement = 'echo "pid=$$ match=$& pre=$` post=$\'"';

	await executeDiffEdit({
		path: filePath,
		diff: diffBlock('echo "old"', replacement),
	});

	t.is(
		await readFile(filePath, 'utf-8'),
		`#!/bin/sh\n${replacement}\nexit 0\n`,
	);
});

test('diff_edit keeps $ tokens literal across multiple blocks', async t => {
	const filePath = await createTestFile(
		'multi.yml',
		'first: OLD_A\nsecond: OLD_B\n',
	);

	await executeDiffEdit({
		path: filePath,
		diff: [
			diffBlock('first: OLD_A', 'first: "$&"'),
			diffBlock('second: OLD_B', "second: \"$`$'\""),
		].join('\n\n'),
	});

	t.is(
		await readFile(filePath, 'utf-8'),
		'first: "$&"\nsecond: "$`$\'"\n',
	);
});
