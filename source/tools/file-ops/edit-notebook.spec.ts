import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {relative, resolve, join} from 'node:path';
import {Box} from 'ink';
import test from 'ava';
import React from 'react';
import stripAnsi from 'strip-ansi';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {calculateBoxWidth} from '@/hooks/useTerminalWidth';
import {renderWithTheme} from '@/test-utils/render-with-theme';
import {resolveToolApproval} from '../approval-policy.js';
import {clearReadTracker} from '../runtime/read-tracker.js';
import {readFileTool} from '../read-file.js';
import {editNotebookTool} from './edit-notebook.js';
import {diffEditTool} from './diff-edit.js';
import {
	fileMutationPaths,
	isFileMutatingTool,
} from './file-mutating-tools.js';

type NotebookCell = {
	cell_type: string;
	source: string | string[];
	metadata: Record<string, unknown>;
	outputs?: unknown[];
	attachments?: unknown;
	id?: string;
	execution_count?: number | null;
};

type NotebookDocument = {
	cells: NotebookCell[];
	[key: string]: unknown;
};

function fixture(): string {
	return [
		'{',
		'  "cells": [',
		'    {',
		'      "cell_type": "code",',
		'      "id": "code-cell",',
		'      "execution_count": 7,',
		'      "metadata": {"tags": ["keep"], "custom": "before"},',
		'      "outputs": [',
		'        {"name": "stdout", "output_type": "stream", "text": ["hello\\r\\n"]},',
		'        {"data": {"image/png": "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"}, "metadata": {"width": 1}, "output_type": "display_data"}',
		'      ],',
		`      "source": ${JSON.stringify(["print('🙂')\r\n", 'x = 1\r\n'])}`,
		'    },',
		'    {',
		'      "cell_type": "markdown",',
		'      "id": "markdown-cell",',
		'      "metadata": {"custom": "markdown"},',
		'      "attachments": {"plot.png": {"image/png": ["attachment-base64-that-must-not-leak"]}},',
		`      "source": ${JSON.stringify(['# Heading\r\n', 'body'])}`,
		'    },',
		'    {',
		'      "cell_type": "raw",',
		'      "id": "raw-cell",',
		'      "metadata": {},',
		`      "source": ${JSON.stringify(['raw 🙂 text'])}`,
		'    }',
		'  ],',
		'  "metadata": {',
		'    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},',
		'    "language_info": {"name": "python", "version": "3.12"}',
		'  },',
		'  "nbformat": 4,',
		'  "nbformat_minor": 5',
		'}',
		'',
	].join('\r\n');
}

function fixture44(): string {
	return fixture()
		.replace(/\r\n      "id": "code-cell",/g, '')
		.replace(/\r\n      "id": "markdown-cell",/g, '')
		.replace(/\r\n      "id": "raw-cell",/g, '')
		.replace('  "nbformat_minor": 5', '  "nbformat_minor": 4');
}

let testDir = '';

test.beforeEach(async () => {
	testDir = await mkdtemp(join(process.cwd(), '.edit-notebook-test-'));
	clearReadTracker();
});

test.afterEach(async () => {
	await rm(testDir, {recursive: true, force: true});
});

function relativePath(filePath: string): string {
	return relative(process.cwd(), filePath);
}

async function createNotebook(content = fixture()): Promise<{
	absolutePath: string;
	path: string;
}> {
	const absolutePath = join(testDir, 'analysis.ipynb');
	await writeFile(absolutePath, content, 'utf8');
	return {absolutePath, path: relativePath(absolutePath)};
}

async function executeRead(path: string): Promise<string> {
	const result = await readFileTool.tool.execute!(
		{path},
		{toolCallId: 'edit-notebook-read-test', messages: []},
	);
	return typeof result === 'string' ? result : result.llmContent;
}

async function readRevision(path: string): Promise<string> {
	const result = await executeRead(path);
	const match = result.match(/Notebook revision:\s*([0-9a-f]{64})/i);
	if (!match?.[1]) throw new Error(`Missing revision in read result:\n${result}`);
	return match[1];
}

async function executeEdit(args: Record<string, unknown>): Promise<string> {
	const result = await editNotebookTool.tool.execute!(args, {
		toolCallId: 'edit-notebook-test',
		messages: [],
	});
	return typeof result === 'string' ? result : result.llmContent;
}

async function parseFile(path: string): Promise<NotebookDocument> {
	return JSON.parse(await readFile(path, 'utf8')) as NotebookDocument;
}

function sourceOf(cell: NotebookCell): string {
	return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}

test('edit_notebook is a mutating tool and reports its changed path', t => {
	t.true(isFileMutatingTool('edit_notebook'));
	t.deepEqual(
		fileMutationPaths('edit_notebook', {path: 'notebooks/analysis.ipynb'}),
		['notebooks/analysis.ipynb'],
	);
	t.deepEqual(fileMutationPaths('edit_notebook', undefined), []);
});

test('edit_notebook requires approval in normal mode and is unattended in yolo', async t => {
	const args = {
		path: 'analysis.ipynb',
		operation: 'replace_source',
		cell_index: 0,
		notebook_revision: 'a'.repeat(64),
		source: 'changed',
	};

	t.true(await resolveToolApproval(editNotebookTool.name, editNotebookTool, args, {mode: 'normal'}));
	t.false(await resolveToolApproval(editNotebookTool.name, editNotebookTool, args, {mode: 'auto-accept'}));
	t.false(await resolveToolApproval(editNotebookTool.name, editNotebookTool, args, {mode: 'yolo'}));
});

test.serial('plain text editors reject .ipynb paths and point to edit_notebook', async t => {
	t.timeout(30000);
	const [{diffEditTool}, {stringReplaceTool}, {writeFileTool}] = await Promise.all([
		import('./diff-edit.js'),
		import('./string-replace.js'),
		import('./write-file.js'),
	]);
	const {path} = await createNotebook();

	const write = await writeFileTool.validator?.({path, content: '{}'});
	const replace = await stringReplaceTool.validator?.({
		path,
		old_str: 'old',
		new_str: 'new',
	});
	const diff = await diffEditTool.validator?.({
		path,
		diff: '<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE',
	});

	for (const result of [write, replace, diff]) {
		t.truthy(result);
		t.false(result?.valid ?? true);
		if (result && !result.valid) t.regex(result.error, /edit_notebook/);
	}
});

test.serial('edit_notebook exposes a cell-oriented ACP preview and edit location', async t => {
	t.timeout(30000);
	const {buildToolCallMeta} = await import('@/acp/acp-tool-call.js');
	const {path} = await createNotebook();
	const revision = await readRevision(path);
	const meta = await buildToolCallMeta({
		id: 'acp-preview',
		function: {
			name: 'edit_notebook',
			arguments: {
				path,
				operation: 'replace_source',
				cell_index: 0,
				notebook_revision: revision,
				source: 'plot = True\n',
			},
		},
	});

	t.is(meta.kind, 'edit');
	t.deepEqual(meta.locations.map(location => location.path), [resolve(path)]);
	t.is(meta.content[0]?.type, 'content');
	const content = meta.content[0];
	if (content?.type === 'content' && content.content.type === 'text') {
		t.regex(content.content.text, /Replace source in cell 0/i);
		t.regex(content.content.text, /plot = True/);
	} else {
		t.fail('edit_notebook ACP preview did not contain text content');
	}
});

test.serial('edit_notebook refuses to edit until the notebook has been read', async t => {
	const {absolutePath, path} = await createNotebook();
	const before = await readFile(absolutePath, 'utf8');

	await t.throwsAsync(
		executeEdit({
			path,
			operation: 'replace_source',
			cell_index: 0,
			notebook_revision: 'a'.repeat(64),
			source: 'must not write',
		}),
		{message: /read.*read_file|read.*before.*edit/i},
	);
	t.is(await readFile(absolutePath, 'utf8'), before);
});

test.serial('replace_source patches only the source bytes and preserves saved outputs and notebook formatting', async t => {
	const {absolutePath, path} = await createNotebook();
	const before = await readFile(absolutePath, 'utf8');
	const revision = await readRevision(path);
	const newSource = "print('changed 🙂')\r\nz = 2\r\n";

	const result = await executeEdit({
		path,
		operation: 'replace_source',
		cell_index: 0,
		notebook_revision: revision,
		source: newSource,
	});

	const after = await readFile(absolutePath, 'utf8');
	const expected = before.replace(
		JSON.stringify(["print('🙂')\r\n", 'x = 1\r\n']),
		JSON.stringify(newSource.split(/(?<=\n)/)),
	);
	const parsed = JSON.parse(after) as NotebookDocument;

	t.is(after, expected);
	t.is(sourceOf(parsed.cells[0]!), newSource);
	t.deepEqual(parsed.cells[0]!.outputs, (JSON.parse(before) as NotebookDocument).cells[0]!.outputs);
	t.deepEqual(parsed.cells[1]!.attachments, (JSON.parse(before) as NotebookDocument).cells[1]!.attachments);
	t.true(after.endsWith('\r\n'));
	t.regex(result, /saved outputs/i);
	t.regex(result, /Notebook revision:\s*[0-9a-f]{64}/i);
});

test.serial('replace_source preserves a UTF-8 BOM while patching the source token', async t => {
	const {absolutePath, path} = await createNotebook(`\uFEFF${fixture()}`);
	const before = await readFile(absolutePath, 'utf8');
	const revision = await readRevision(path);
	const newSource = 'bom_safe = True\r\n';

	await executeEdit({
		path,
		operation: 'replace_source',
		cell_index: 0,
		notebook_revision: revision,
		source: newSource,
	});

	const after = await readFile(absolutePath, 'utf8');
	t.is(
		after,
		before.replace(
			JSON.stringify(["print('🙂')\r\n", 'x = 1\r\n']),
			JSON.stringify([newSource]),
		),
	);
	t.true(after.startsWith('\uFEFF'));
});

test.serial('replace_source preserves a notebook whose source is a JSON string rather than an array', async t => {
	const content = JSON.stringify({
		cells: [{
			cell_type: 'markdown',
			id: 'string-source',
			metadata: {keep: true},
			source: 'old source',
		}],
		metadata: {},
		nbformat: 4,
		nbformat_minor: 5,
	});
	const {absolutePath, path} = await createNotebook(content);
	const revision = await readRevision(path);

	await executeEdit({
		path,
		operation: 'replace_source',
		cell_index: 0,
		notebook_revision: revision,
		source: 'new source 🙂',
	});

	const parsed = await parseFile(absolutePath);
	t.is(parsed.cells[0]!.source, 'new source 🙂');
	t.deepEqual(parsed.cells[0]!.metadata, {keep: true});
});

test.serial('insert_cell inserts before the requested index and generates an id for nbformat 4.5', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);

	await executeEdit({
		path,
		operation: 'insert_cell',
		cell_index: 1,
		notebook_revision: revision,
		cell_type: 'code',
		source: 'split = True\n',
	});

	const parsed = await parseFile(absolutePath);
	t.is(parsed.cells.length, 4);
	t.is(parsed.cells[1]!.cell_type, 'code');
	t.is(sourceOf(parsed.cells[1]!), 'split = True\n');
	t.regex(parsed.cells[1]!.id ?? '', /^[A-Za-z0-9_-]{1,64}$/);
	t.deepEqual(parsed.cells[1]!.outputs, []);
	t.is(parsed.cells[0]!.id, 'code-cell');
	t.is(parsed.cells[2]!.id, 'markdown-cell');
});

test.serial('insert_cell supports nbformat 4.4 without adding an id', async t => {
	const {absolutePath, path} = await createNotebook(fixture44());
	const revision = await readRevision(path);

	await executeEdit({
		path,
		operation: 'insert_cell',
		cell_index: 1,
		notebook_revision: revision,
		cell_type: 'markdown',
		source: 'inserted\n',
	});

	const parsed = await parseFile(absolutePath);
	t.is(parsed.nbformat_minor, 4);
	t.false('id' in parsed.cells[1]!);
});

test.serial('delete_cell removes one cell while preserving untouched cells and outputs', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);

	const result = await executeEdit({
		path,
		operation: 'delete_cell',
		cell_index: 1,
		notebook_revision: revision,
	});

	const parsed = await parseFile(absolutePath);
	t.is(parsed.cells.length, 2);
	t.is(parsed.cells[0]!.id, 'code-cell');
	t.is(parsed.cells[1]!.id, 'raw-cell');
	t.is(parsed.cells[0]!.outputs?.length, 2);
	t.regex(result, /Delete cell 1/i);
});

test.serial('change_cell_type previews and removes outputs when converting code to markdown', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);

	const result = await executeEdit({
		path,
		operation: 'change_cell_type',
		cell_index: 0,
		notebook_revision: revision,
		cell_type: 'markdown',
	});

	const parsed = await parseFile(absolutePath);
	t.is(parsed.cells[0]!.cell_type, 'markdown');
	t.is(parsed.cells[0]!.outputs, undefined);
	t.is(parsed.cells[0]!.execution_count, undefined);
	t.regex(result, /Removes 2 saved output/i);
});

test.serial('change_cell_type previews and removes attachments when converting markdown to code', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);

	const result = await executeEdit({
		path,
		operation: 'change_cell_type',
		cell_index: 1,
		notebook_revision: revision,
		cell_type: 'code',
	});

	const parsed = await parseFile(absolutePath);
	t.is(parsed.cells[1]!.cell_type, 'code');
	t.is(parsed.cells[1]!.attachments, undefined);
	t.is(parsed.cells[1]!.execution_count, null);
	t.deepEqual(parsed.cells[1]!.outputs, []);
	t.regex(result, /Removes 1 attachment/i);
});

test.serial('edit_notebook rejects a stale revision without writing', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);
	const before = await readFile(absolutePath, 'utf8');
	await writeFile(absolutePath, `${before} `, 'utf8');
	const changed = await readFile(absolutePath, 'utf8');

	await t.throwsAsync(
		executeEdit({
			path,
			operation: 'replace_source',
			cell_index: 0,
			notebook_revision: revision,
			source: 'stale edit must not write',
		}),
		{message: /revision|changed|read again/i},
	);
	t.is(await readFile(absolutePath, 'utf8'), changed);
});

test.serial('edit_notebook rejects a second edit using the old revision', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);

	const first = await executeEdit({
		path,
		operation: 'replace_source',
		cell_index: 0,
		notebook_revision: revision,
		source: 'first = True\n',
	});
	t.regex(first, /Notebook revision:\s*[0-9a-f]{64}/i);
	await executeRead(path);

	await t.throwsAsync(
		executeEdit({
			path,
			operation: 'replace_source',
			cell_index: 0,
			notebook_revision: revision,
			source: 'second = True\n',
		}),
		{message: /revision|stale|current/i},
	);
	t.is(sourceOf((await parseFile(absolutePath)).cells[0]!), 'first = True\n');
});

test.serial('concurrent edits to one notebook are arbitrated before either can overwrite the other', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);
	const args = (source: string) => ({
		path,
		operation: 'replace_source',
		cell_index: 0,
		notebook_revision: revision,
		source,
	});

	const outcomes = await Promise.allSettled([
		executeEdit(args('parallel_a = True\n')),
		executeEdit(args('parallel_b = True\n')),
	]);
	const fulfilled = outcomes.filter(outcome => outcome.status === 'fulfilled');
	const rejected = outcomes.filter(outcome => outcome.status === 'rejected');

	t.is(fulfilled.length, 1);
	t.is(rejected.length, 1);
	if (rejected[0]?.status === 'rejected') {
		t.regex(String(rejected[0].reason), /another edit is in progress/i);
	}
	const source = sourceOf((await parseFile(absolutePath)).cells[0]!);
	t.true(source === 'parallel_a = True\n' || source === 'parallel_b = True\n');
});

test.serial('edit_notebook validates indexes before writing', async t => {
	const {absolutePath, path} = await createNotebook();
	const revision = await readRevision(path);
	const before = await readFile(absolutePath, 'utf8');

	await t.throwsAsync(
		executeEdit({
			path,
			operation: 'delete_cell',
			cell_index: 99,
			notebook_revision: revision,
		}),
		{message: /out of range/i},
	);
	t.is(await readFile(absolutePath, 'utf8'), before);
});

test.serial('edit_notebook approval preview stays inside the dialog at common terminal widths', async t => {
	const {path} = await createNotebook();
	const revision = await readRevision(path);
	const formatter = editNotebookTool.formatter;
	if (!formatter) throw new Error('edit_notebook formatter is not defined');
	const preview = await formatter({
		path,
		operation: 'replace_source',
		cell_index: 0,
		notebook_revision: revision,
		source: 'ax.set_title("Monthly sales totals")\n',
		description:
			'Update the chart title while keeping the rest of the notebook unchanged',
	});
	const originalColumns = process.stdout.columns;

	try {
		for (const columns of [108, 78]) {
			Object.defineProperty(process.stdout, 'columns', {
				value: columns,
				configurable: true,
			});
			const width = calculateBoxWidth(columns);
			const app = renderWithTheme(
				React.createElement(
					TitledBoxWithPreferences,
					{
						title: 'Tool Approval',
						width,
						paddingX: 2,
						paddingY: 1,
						borderColor: 'cyan',
					},
					React.createElement(
						Box,
						{flexDirection: 'column'},
						React.createElement(
							Box,
							{marginBottom: 1, flexDirection: 'column'},
							React.createElement(Box, null, preview),
						),
					),
				),
			);
			const frame = app.lastFrame();
			app.unmount();

			t.truthy(frame);
			const lines = stripAnsi(frame!).split('\n').map(line => line.trimEnd());
			const widestLine = Math.max(...lines.map(line => line.length));
			t.true(
				widestLine <= width,
				`preview should stay within the ${width}-column dialog at ${columns} terminal columns; widest line was ${widestLine}`,
			);
			t.regex(frame!, /Replace source in cell 0/i);
			t.regex(frame!, /Monthly sales totals/);
		}
	} finally {
		Object.defineProperty(process.stdout, 'columns', {
			value: originalColumns,
			configurable: true,
		});
	}
});
