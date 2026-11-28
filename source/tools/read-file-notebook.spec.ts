import {mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {relative, join} from 'node:path';
import test from 'ava';
import {clearReadTracker} from './runtime/read-tracker.js';
import {readFileTool} from './read-file.js';

type NotebookCell = {
	cell_type: string;
	source: string | string[];
	outputs?: unknown[];
	attachments?: unknown;
	id?: string;
};

type NotebookDocument = {
	cells: NotebookCell[];
	[key: string]: unknown;
};

/**
 * Keep this fixture hand-authored rather than JSON.stringify-ing it.  The
 * notebook tools promise offset patches, so whitespace, CRLF, key order,
 * escaped source strings, rich output and trailing bytes are all meaningful.
 */
function notebookFixture(options: {
	minor?: number;
	includeIds?: boolean;
} = {}): string {
	const minor = options.minor ?? 5;
	const includeIds = options.includeIds ?? minor >= 5;
	const codeId = includeIds ? '      "id": "code-cell",\r\n' : '';
	const markdownId = includeIds ? '      "id": "markdown-cell",\r\n' : '';
	const rawId = includeIds ? '      "id": "raw-cell",\r\n' : '';

	return [
		'{',
		'  "cells": [',
		'    {',
		'      "cell_type": "code",',
		codeId.trimEnd(),
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
		markdownId.trimEnd(),
		'      "metadata": {"custom": "markdown"},',
		'      "attachments": {"plot.png": {"image/png": ["attachment-base64-that-must-not-leak"]}},',
		`      "source": ${JSON.stringify(['# Heading\r\n', 'body'])}`,
		'    },',
		'    {',
		'      "cell_type": "raw",',
		rawId.trimEnd(),
		'      "metadata": {},',
		`      "source": ${JSON.stringify(['raw 🙂 text'])}`,
		'    }',
		'  ],',
		'  "metadata": {',
		'    "kernelspec": {"display_name": "Python 3", "language": "python", "name": "python3"},',
		'    "language_info": {"name": "python", "version": "3.12"}',
		'  },',
		'  "nbformat": 4,',
		`  "nbformat_minor": ${minor}`,
		'}',
		'',
	].join('\r\n');
}

let testDir = '';

test.beforeEach(async () => {
	testDir = await mkdtemp(join(process.cwd(), '.read-notebook-test-'));
	clearReadTracker();
});

test.afterEach(async () => {
	await rm(testDir, {recursive: true, force: true});
});

function relativePath(filePath: string): string {
	return relative(process.cwd(), filePath);
}

async function createNotebook(
	text = notebookFixture(),
): Promise<{absolutePath: string; path: string}> {
	const absolutePath = join(testDir, 'analysis.ipynb');
	await writeFile(absolutePath, text, 'utf8');
	return {absolutePath, path: relativePath(absolutePath)};
}

async function executeRead(args: Record<string, unknown>): Promise<string> {
	const result = await readFileTool.tool.execute!(args, {
		toolCallId: 'read-notebook-test',
		messages: [],
	});
	return typeof result === 'string' ? result : result.llmContent;
}

function parseNotebook(text: string): NotebookDocument {
	return JSON.parse(text) as NotebookDocument;
}

function sourceOf(cell: NotebookCell): string {
	return Array.isArray(cell.source) ? cell.source.join('') : cell.source;
}

function revisionOf(result: string): string {
	const match = result.match(/Notebook revision:\s*([0-9a-f]{64})/i);
	if (!match?.[1]) {
		throw new Error(`read_file did not return a notebook revision:\n${result}`);
	}
	return match[1];
}

test.serial('read_file renders a compact cell view with revision and text-only output summaries', async t => {
	const {path} = await createNotebook();

	const result = await executeRead({path});

	t.regex(result, /Notebook revision:\s*[0-9a-f]{64}/i);
	t.regex(result, /Cell\s+0/i);
	t.regex(result, /code/i);
	t.regex(result, /print\('\W*'?|print/i);
	t.regex(result, /hello/);
	// Rich output and attachments are intentionally summarized, never copied
	// into the model-facing result.
	t.false(result.includes('iVBORw0KGgoAAA'));
	t.false(result.includes('attachment-base64-that-must-not-leak'));
	t.false(result.includes('display_data'));
});

test.serial('read_file limits notebook reads to an inclusive zero-based cell range', async t => {
	const {path} = await createNotebook();

	const result = await executeRead({path, start_cell: 1, end_cell: 1});

	t.regex(result, /Notebook revision:\s*[0-9a-f]{64}/i);
	t.regex(result, /Cell\s+1/i);
	t.regex(result, /Heading/);
	t.notRegex(result, /print\('\W*'?|x = 1/);
	t.notRegex(result, /raw 🙂 text/);
});

test.serial('read_file revisions are stable for unchanged notebook bytes', async t => {
	const {path} = await createNotebook();

	const first = await executeRead({path});
	const second = await executeRead({path, start_cell: 0, end_cell: 0});

	t.is(revisionOf(first), revisionOf(second));
});

test.serial('read_file accepts nbformat 4.4 notebooks without manufacturing cell ids', async t => {
	const {absolutePath, path} = await createNotebook(
		notebookFixture({minor: 4, includeIds: false}),
	);

	const result = await executeRead({path});
	const parsed = parseNotebook(await readFile(absolutePath, 'utf8'));

	t.is(parsed.nbformat_minor, 4);
	t.false('id' in parsed.cells[0]!);
	t.regex(result, /Notebook revision:\s*[0-9a-f]{64}/i);
});

test.serial('read_file can return a UTF-16 source slice for one cell', async t => {
	const {path} = await createNotebook();

	// The emoji occupies two UTF-16 code units.  This offset starts at the
	// `x` after `print('🙂')\r\n`, proving the tool does not count UTF-8 bytes.
	const result = await executeRead({
		path,
		start_cell: 0,
		end_cell: 0,
		source_offset: 13,
	});

	t.regex(result, /x = 1/);
	t.notRegex(result, /# Heading/);
});

test.serial('read_file paginates long notebooks and advertises the next cell range', async t => {
	const cells = Array.from({length: 10}, (_, index) => ({
		cell_type: 'code',
		id: `cell-${index}`,
		execution_count: null,
		metadata: {},
		outputs: [],
		source: [`value = ${index}\n`],
	}));
	const {path} = await createNotebook(
		JSON.stringify({cells, metadata: {}, nbformat: 4, nbformat_minor: 5}),
	);

	const firstPage = await executeRead({path});
	const secondPage = await executeRead({path, start_cell: 8, end_cell: 9});

	t.regex(firstPage, /Cell 0/);
	t.regex(firstPage, /Cell 7/);
	t.notRegex(firstPage, /Cell 8/);
	t.regex(firstPage, /More cells: read_file with start_cell=8/);
	t.regex(secondPage, /Cell 8/);
	t.regex(secondPage, /Cell 9/);
	t.notRegex(secondPage, /Cell 7/);
});

test.serial('read_file resumes a long cell source at a UTF-16 offset', async t => {
	const source = `${'a'.repeat(3000)}🙂tail`;
	const {path} = await createNotebook(
		JSON.stringify({
			cells: [{
				cell_type: 'markdown',
				id: 'long-cell',
				metadata: {},
				source,
			}],
			metadata: {},
			nbformat: 4,
			nbformat_minor: 5,
		}),
	);

	const firstPage = await executeRead({path, start_cell: 0, end_cell: 0});
	const continuation = await executeRead({
		path,
		start_cell: 0,
		end_cell: 0,
		source_offset: 3000,
	});

	t.regex(firstPage, /More source: read_file with start_cell=0, end_cell=0, source_offset=3000/);
	t.regex(continuation, /🙂tail/);
	t.notRegex(continuation, /a{200}/);
});
