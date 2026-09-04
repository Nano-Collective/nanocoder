import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import type {TextEdit} from '@/lsp/index';
import {
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import {
	applyTextEdits,
	formatDocumentTool,
	formatFileWithLsp,
	type FormatLspManager,
} from './lsp-format-document.js';

function edit(
	startLine: number,
	startChar: number,
	endLine: number,
	endChar: number,
	newText: string,
): TextEdit {
	return {
		range: {
			start: {line: startLine, character: startChar},
			end: {line: endLine, character: endChar},
		},
		newText,
	};
}

function mockManager(
	overrides: Partial<FormatLspManager> = {},
): FormatLspManager {
	return {
		isInitialized: () => true,
		hasLanguageSupport: () => true,
		openDocument: async () => true,
		formatDocument: async () => [],
		updateDocument: () => true,
		...overrides,
	};
}

// ============================================================================
// applyTextEdits
// ============================================================================

test('applyTextEdits: replaces a single range', t => {
	const content = 'hello world\n';
	const result = applyTextEdits(content, [edit(0, 6, 0, 11, 'there')]);
	t.is(result, 'hello there\n');
});

test('applyTextEdits: applies multiple edits bottom-to-top', t => {
	const content = 'aaa\nbbb\nccc\n';
	const result = applyTextEdits(content, [
		edit(0, 0, 0, 3, 'AAA'),
		edit(2, 0, 2, 3, 'CCC'),
	]);
	t.is(result, 'AAA\nbbb\nCCC\n');
});

test('applyTextEdits: inserts text at a position', t => {
	const content = 'abc';
	const result = applyTextEdits(content, [edit(0, 1, 0, 1, 'X')]);
	t.is(result, 'aXbc');
});

test('applyTextEdits: deletes a range with empty newText', t => {
	const content = 'abcdef';
	const result = applyTextEdits(content, [edit(0, 2, 0, 4, '')]);
	t.is(result, 'abef');
});

test('applyTextEdits: handles multi-line replacement', t => {
	const content = 'line1\nline2\nline3\n';
	const result = applyTextEdits(content, [edit(0, 0, 1, 5, 'merged')]);
	t.is(result, 'merged\nline3\n');
});

test('applyTextEdits: empty edits returns original content', t => {
	const content = 'unchanged\n';
	t.is(applyTextEdits(content, []), content);
});

test('applyTextEdits: full-document replace', t => {
	const content = 'old\ncontent\n';
	const result = applyTextEdits(content, [edit(0, 0, 1, 8, 'new\nbody')]);
	t.is(result, 'new\nbody');
});

test('applyTextEdits: works with CRLF line endings', t => {
	const content = 'foo\r\nbar\r\n';
	// After \n of first line, second line starts at "bar"
	const result = applyTextEdits(content, [edit(1, 0, 1, 3, 'BAZ')]);
	t.is(result, 'foo\r\nBAZ\r\n');
});

// ============================================================================
// formatFileWithLsp orchestration
// ============================================================================

test('formatFileWithLsp: returns clear message when LSP not initialized', async t => {
	const message = await formatFileWithLsp(
		'/tmp/unused.ts',
		'src/unused.ts',
		mockManager({isInitialized: () => false}),
	);
	t.regex(message, /No language server available/);
});

test('formatFileWithLsp: returns clear message when file type unsupported', async t => {
	const message = await formatFileWithLsp(
		'/tmp/unused.xyz',
		'src/unused.xyz',
		mockManager({hasLanguageSupport: () => false}),
	);
	t.is(message, 'No language server available for file type: src/unused.xyz.');
});

test('formatFileWithLsp: returns clear message when server not ready', async t => {
	const message = await formatFileWithLsp(
		'/tmp/unused.ts',
		'src/unused.ts',
		mockManager({openDocument: async () => false}),
	);
	t.is(message, 'Language server for src/unused.ts is not ready.');
});

test('formatFileWithLsp: reports no changes when edits are empty', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'nc-fmt-'));
	t.teardown(async () => {
		await rm(dir, {recursive: true, force: true});
	});
	const filePath = join(dir, 'a.ts');
	await writeFile(filePath, 'const x = 1;\n', 'utf-8');

	const message = await formatFileWithLsp(
		filePath,
		'a.ts',
		mockManager({formatDocument: async () => []}),
	);
	t.is(message, 'No formatting changes needed for a.ts.');
});

test('formatFileWithLsp: applies edits and writes the file', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'nc-fmt-'));
	t.teardown(async () => {
		await rm(dir, {recursive: true, force: true});
	});
	const filePath = join(dir, 'a.ts');
	await writeFile(filePath, 'const x=1\n', 'utf-8');

	let updatedContent: string | undefined;
	const message = await formatFileWithLsp(
		filePath,
		'a.ts',
		mockManager({
			formatDocument: async () => [edit(0, 7, 0, 7, ' ')],
			updateDocument: (_path, content) => {
				updatedContent = content;
				return true;
			},
		}),
	);

	t.is(message, 'Formatted a.ts (1 edit applied).');
	t.is(await readFile(filePath, 'utf-8'), 'const x =1\n');
	t.is(updatedContent, 'const x =1\n');
});

test('formatFileWithLsp: pluralizes edit count', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'nc-fmt-'));
	t.teardown(async () => {
		await rm(dir, {recursive: true, force: true});
	});
	const filePath = join(dir, 'a.ts');
	await writeFile(filePath, 'ab\n', 'utf-8');

	const message = await formatFileWithLsp(
		filePath,
		'a.ts',
		mockManager({
			formatDocument: async () => [
				edit(0, 0, 0, 1, 'A'),
				edit(0, 1, 0, 2, 'B'),
			],
		}),
	);

	t.is(message, 'Formatted a.ts (2 edits applied).');
	t.is(await readFile(filePath, 'utf-8'), 'AB\n');
});

test('formatFileWithLsp: no-op when applied edits leave content unchanged', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'nc-fmt-'));
	t.teardown(async () => {
		await rm(dir, {recursive: true, force: true});
	});
	const filePath = join(dir, 'a.ts');
	await writeFile(filePath, 'same\n', 'utf-8');

	const message = await formatFileWithLsp(
		filePath,
		'a.ts',
		mockManager({
			// Replace "same" with "same" — edit count > 0 but content identical
			formatDocument: async () => [edit(0, 0, 0, 4, 'same')],
		}),
	);

	t.is(message, 'No formatting changes needed for a.ts.');
	t.is(await readFile(filePath, 'utf-8'), 'same\n');
});

// ============================================================================
// Tool metadata / schema / formatter / validator
// ============================================================================

test('lsp_format_document: tool export metadata', t => {
	t.is(formatDocumentTool.name, 'lsp_format_document');
	t.falsy(formatDocumentTool.readOnly);
	t.truthy(formatDocumentTool.approval);
	t.truthy(formatDocumentTool.formatter);
	t.truthy(formatDocumentTool.validator);
	t.truthy(formatDocumentTool.tool);
	t.truthy(formatDocumentTool.tool.description);
	t.truthy(formatDocumentTool.tool.inputSchema);
	t.truthy(formatDocumentTool.tool.execute);
});

test('lsp_format_document formatter: preview without result', t => {
	const preview = formatDocumentTool.formatter?.({path: 'src/a.ts'});
	t.truthy(preview);
});

test('lsp_format_document formatter: preview with success result', t => {
	const preview = formatDocumentTool.formatter?.(
		{path: 'src/a.ts'},
		'Formatted src/a.ts (1 edit applied).',
	);
	t.truthy(preview);
});

test('lsp_format_document validator: rejects missing path', async t => {
	const result = await formatDocumentTool.validator?.({path: ''} as never);
	t.false(result?.valid);
	if (result && !result.valid) {
		t.regex(result.error, /path is required/i);
	}
});

test('lsp_format_document validator: rejects nonexistent file', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'nc-fmt-val-'));
	t.teardown(async () => {
		resetSessionCwd();
		await rm(dir, {recursive: true, force: true});
	});
	setProjectRoot(dir);
	setSessionCwd(dir);

	const result = await formatDocumentTool.validator?.({
		path: 'does-not-exist.ts',
	});
	t.false(result?.valid);
	if (result && !result.valid) {
		t.regex(result.error, /does not exist/i);
	}
});

test('lsp_format_document validator: accepts existing file in session cwd', async t => {
	const dir = await mkdtemp(join(tmpdir(), 'nc-fmt-val-'));
	t.teardown(async () => {
		resetSessionCwd();
		await rm(dir, {recursive: true, force: true});
	});
	await writeFile(join(dir, 'ok.ts'), 'export {}\n', 'utf-8');
	setProjectRoot(dir);
	setSessionCwd(dir);

	const result = await formatDocumentTool.validator?.({path: 'ok.ts'});
	t.true(result?.valid);
});
