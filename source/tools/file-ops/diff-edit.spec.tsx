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
