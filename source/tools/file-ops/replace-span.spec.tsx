import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import test from 'ava';
import {render} from 'ink-testing-library';
import React from 'react';
import {themes} from '@/config/themes';
import {ThemeContext} from '@/hooks/useTheme';
import {clearReadTracker} from '@/utils/read-tracker';
import {
	clearSpanHandles,
	registerSpanForRange,
} from '@/utils/span-handles';
import {readFileTool} from '../read-file';
import {searchFileContentsTool} from '../search-file-contents';
import {replaceSpanTool} from './replace-span';

console.log(`\nreplace-span.spec.tsx`);

test.beforeEach(() => {
	clearReadTracker();
	clearSpanHandles();
});

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

async function withTempFile<T>(
	content: string,
	fn: (path: string) => Promise<T>,
): Promise<T> {
	const dir = await mkdtemp(join(tmpdir(), 'replace-span-'));
	const path = join(dir, 'file.ts');
	try {
		await writeFile(path, content, 'utf-8');
		return await fn(path);
	} finally {
		await rm(dir, {recursive: true, force: true});
	}
}

async function executeReplaceSpan(args: {
	handle: string;
	new_content: string;
}): Promise<string> {
	return await replaceSpanTool.tool.execute!(args, {
		toolCallId: 'test',
		messages: [],
	});
}

// ============================================================================
// Basic Replacement Tests
// ============================================================================

test.serial('replaces a single-line span', async t => {
	await withTempFile('one\ntwo\nthree\n', async path => {
		const handle = registerSpanForRange(path, 2, 2, 'one\ntwo\nthree\n');
		const result = await executeReplaceSpan({
			handle,
			new_content: 'TWO-REPLACED',
		});

		t.regex(result, /Successfully replaced content at line 2/);
		const updated = await readFile(path, 'utf-8');
		t.is(updated, 'one\nTWO-REPLACED\nthree\n');
	});
});

test.serial('replaces a multi-line span with fewer lines', async t => {
	await withTempFile('a\nb\nc\nd\ne\n', async path => {
		const content = 'a\nb\nc\nd\ne\n';
		const handle = registerSpanForRange(path, 2, 4, content);
		const result = await executeReplaceSpan({handle, new_content: 'X'});

		t.regex(result, /Successfully replaced content at lines 2-4 \(now line 2\)/);
		const updated = await readFile(path, 'utf-8');
		t.is(updated, 'a\nX\ne\n');
	});
});

test.serial('replaces a span with more lines than it had', async t => {
	await withTempFile('a\nb\nc\n', async path => {
		const content = 'a\nb\nc\n';
		const handle = registerSpanForRange(path, 2, 2, content);
		const result = await executeReplaceSpan({
			handle,
			new_content: 'b1\nb2\nb3',
		});

		t.regex(result, /now lines 2-4/);
		const updated = await readFile(path, 'utf-8');
		t.is(updated, 'a\nb1\nb2\nb3\nc\n');
	});
});

test.serial('consumes the handle so a replay fails as unknown', async t => {
	await withTempFile('one\n', async path => {
		const handle = registerSpanForRange(path, 1, 1, 'one\n');
		await executeReplaceSpan({handle, new_content: 'first'});

		await t.throwsAsync(
			executeReplaceSpan({handle, new_content: 'second'}),
			{message: /Unknown span handle/},
		);
	});
});

// ============================================================================
// Stale / Unknown Handle Tests
// ============================================================================

test.serial('throws a clear error for an unknown handle', async t => {
	await t.throwsAsync(
		executeReplaceSpan({handle: '@span:never-issued', new_content: 'x'}),
		{message: /Unknown span handle/},
	);
});

test.serial(
	'throws a clear error when the file changed since the handle was issued',
	async t => {
		await withTempFile('old\n', async path => {
			const handle = registerSpanForRange(path, 1, 1, 'old\n');
			await writeFile(path, 'changed externally\n', 'utf-8');

			await t.throwsAsync(
				executeReplaceSpan({handle, new_content: 'new'}),
				{message: /content at this span has changed/},
			);
		});
	},
);

// ============================================================================
// Overlapping Span Tests
// ============================================================================

test.serial(
	'editing one span leaves an overlapping sibling handle stale',
	async t => {
		await withTempFile('one\ntwo\nthree\n', async path => {
			const content = 'one\ntwo\nthree\n';
			const whole = registerSpanForRange(path, 1, 3, content);
			const middle = registerSpanForRange(path, 2, 2, content);

			await executeReplaceSpan({handle: whole, new_content: 'ONE\nTWO\nTHREE'});

			await t.throwsAsync(
				executeReplaceSpan({handle: middle, new_content: 'x'}),
				{message: /content at this span has changed/},
			);
		});
	},
);

// ============================================================================
// Validator Tests
// ============================================================================

test.serial('validator rejects an empty handle', async t => {
	const result = await replaceSpanTool.validator!({
		handle: '',
		new_content: 'x',
	});
	t.false(result.valid);
	if (!result.valid) t.regex(result.error, /handle cannot be empty/);
});

test.serial('validator rejects an unknown handle', async t => {
	const result = await replaceSpanTool.validator!({
		handle: '@span:never-issued',
		new_content: 'x',
	});
	t.false(result.valid);
	if (!result.valid) t.regex(result.error, /Unknown span handle/);
});

test.serial('validator accepts a freshly registered handle', async t => {
	await withTempFile('content\n', async path => {
		const handle = registerSpanForRange(path, 1, 1, 'content\n');
		const result = await replaceSpanTool.validator!({
			handle,
			new_content: 'new',
		});
		t.true(result.valid);
	});
});

// ============================================================================
// End-to-end: read_file / search_file_contents issue the handle
// ============================================================================

test.serial(
	'a handle from read_file output can be resolved and edited',
	async t => {
		await withTempFile('alpha\nbeta\ngamma\n', async path => {
			const readResult = await readFileTool.tool.execute!(
				{path},
				{toolCallId: 'test', messages: []},
			);

			const match = readResult.match(/\[@span:([a-z0-9]+)\]/);
			t.truthy(match, `expected a span handle in read_file output: ${readResult}`);
			const handle = `@span:${match![1]}`;

			// read_file's span covers the whole file, split('\n') included — a
			// trailing '\n' tokenizes to a trailing empty element, so new_content
			// must include one back to preserve it.
			const result = await executeReplaceSpan({
				handle,
				new_content: 'alpha\nBETA\ngamma\n',
			});
			t.regex(result, /Successfully replaced/);

			const updated = await readFile(path, 'utf-8');
			t.is(updated, 'alpha\nBETA\ngamma\n');
		});
	},
);

test.serial(
	'a handle from search_file_contents output can be resolved and edited',
	async t => {
		await withTempFile('foo\nneedle\nbar\n', async path => {
			const originalCwd = process.cwd();
			try {
				process.chdir(dirname(path));
				const searchResult = await searchFileContentsTool.tool.execute!(
					{query: 'needle'},
					{toolCallId: 'test', messages: []},
				);

				const match = searchResult.match(/\[@span:([a-z0-9]+)\]/);
				t.truthy(
					match,
					`expected a span handle in search_file_contents output: ${searchResult}`,
				);
				const handle = `@span:${match![1]}`;

				const result = await executeReplaceSpan({
					handle,
					new_content: 'NEEDLE-FOUND',
				});
				t.regex(result, /Successfully replaced/);
			} finally {
				process.chdir(originalCwd);
			}

			const updated = await readFile(path, 'utf-8');
			t.is(updated, 'foo\nNEEDLE-FOUND\nbar\n');
		});
	},
);

// search_file_contents trims a match and clips it at 300 characters, so the
// handle has to be hashed from the file's own line, not from the match text.
test.serial(
	'a handle from an indented search_file_contents match can be edited',
	async t => {
		const source =
			'function f() {\n    if (cond) {\n        needle();   \n    }\n}\n';
		await withTempFile(source, async path => {
			const originalCwd = process.cwd();
			try {
				process.chdir(dirname(path));
				const searchResult = await searchFileContentsTool.tool.execute!(
					{query: 'needle'},
					{toolCallId: 'test', messages: []},
				);

				const match = searchResult.match(/\[@span:([a-z0-9]+)\]/);
				t.truthy(match, `expected a span handle: ${searchResult}`);

				const result = await executeReplaceSpan({
					handle: `@span:${match![1]}`,
					new_content: '        replaced();',
				});
				t.regex(result, /Successfully replaced/);
			} finally {
				process.chdir(originalCwd);
			}

			t.is(
				await readFile(path, 'utf-8'),
				'function f() {\n    if (cond) {\n        replaced();\n    }\n}\n',
			);
		});
	},
);

test.serial(
	'a handle from a long, clipped search_file_contents match can be edited',
	async t => {
		const longLine = `${'x'.repeat(400)}needle${'y'.repeat(100)}`;
		await withTempFile(`before\n${longLine}\nafter\n`, async path => {
			const originalCwd = process.cwd();
			try {
				process.chdir(dirname(path));
				const searchResult = await searchFileContentsTool.tool.execute!(
					{query: 'needle'},
					{toolCallId: 'test', messages: []},
				);

				// The match text is clipped, which is what used to break the hash.
				t.false(searchResult.includes(longLine));
				const match = searchResult.match(/\[@span:([a-z0-9]+)\]/);
				t.truthy(match, `expected a span handle: ${searchResult}`);

				const result = await executeReplaceSpan({
					handle: `@span:${match![1]}`,
					new_content: 'short',
				});
				t.regex(result, /Successfully replaced/);
			} finally {
				process.chdir(originalCwd);
			}

			t.is(await readFile(path, 'utf-8'), 'before\nshort\nafter\n');
		});
	},
);

// ============================================================================
// Formatter Tests
// ============================================================================

test.serial('formatter renders the handle', async t => {
	const formatter = replaceSpanTool.formatter!;
	const element = await formatter(
		{handle: '@span:k7', new_content: 'x'},
		'Successfully replaced content at line 2 (now line 2).',
	);
	const {lastFrame} = render(<TestThemeProvider>{element}</TestThemeProvider>);

	const output = lastFrame();
	t.truthy(output);
	t.regex(output!, /replace_span/);
	t.regex(output!, /@span:k7/);
});
