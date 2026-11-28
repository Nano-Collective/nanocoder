import {isUtf8} from 'node:buffer';
import {createHash} from 'node:crypto';
import {readFile, stat} from 'node:fs/promises';
import {extname} from 'node:path';
import type {Node, ParseError} from 'jsonc-parser';
import {stripUtf8Bom} from '@/utils/strip-utf8-bom';
import {truncateText} from '@/utils/truncate-text';

export const NOTEBOOK_CELL_TYPES = ['code', 'markdown', 'raw'] as const;
export type NotebookCellType = (typeof NOTEBOOK_CELL_TYPES)[number];

export interface NotebookRange {
	start_cell?: number;
	end_cell?: number;
	source_offset?: number;
}

interface NotebookCell {
	node: Node;
	type: string;
	id?: string;
	sourceNode: Node;
}

export interface Notebook {
	text: string;
	bom: string;
	minor: number;
	array: Node;
	cells: NotebookCell[];
}

const CELL_PAGE_SIZE = 8;
const SOURCE_PAGE_SIZE = 3000;
const OUTPUTS_PER_CELL = 4;
const OUTPUT_TEXT_LIMIT = 240;
const CELL_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function isNotebookPath(path: string): boolean {
	return extname(path).toLowerCase() === '.ipynb';
}

export function getNotebookRevision(content: string): string {
	return createHash('sha256').update(content).digest('hex');
}

export async function readNotebookText(path: string): Promise<string> {
	if (!(await stat(path)).isFile()) {
		throw new Error('A notebook must be a regular file.');
	}
	const bytes = await readFile(path);
	if (!isUtf8(bytes)) throw new Error('A notebook must be valid UTF-8.');
	return bytes.toString('utf8');
}

export function getProperty(
	node: Node | undefined,
	key: string,
): Node | undefined {
	if (node?.type !== 'object') return undefined;
	return node.children?.find(prop => prop.children?.[0]?.value === key)
		?.children?.[1];
}

function stringValue(node: Node | undefined): string | undefined {
	return node?.type === 'string' ? node.value : undefined;
}

function isTextNode(node: Node | undefined): node is Node {
	return (
		node?.type === 'string' ||
		(node?.type === 'array' &&
			(node.children ?? []).every(item => item.type === 'string'))
	);
}

export function notebookTextValue(node: Node): string {
	return (
		stringValue(node) ??
		(node.children ?? []).map(child => child.value).join('')
	);
}

function requireUniqueProperties(node: Node, label: string): void {
	const keys = new Set(
		(node.children ?? []).map(property => property.children?.[0]?.value),
	);
	if (keys.size !== (node.children?.length ?? 0)) {
		throw new Error(`${label} contains duplicate JSON properties.`);
	}
}

export async function parseNotebook(content: string): Promise<Notebook> {
	const {parseTree} = await import('jsonc-parser');
	const text = stripUtf8Bom(content);
	const bom = content.slice(0, content.length - text.length);
	const errors: ParseError[] = [];
	const root = parseTree(text, errors, {
		disallowComments: true,
		allowTrailingComma: false,
	});
	if (!root || errors.length || root.type !== 'object') {
		throw new Error('The notebook must contain a valid JSON object.');
	}
	requireUniqueProperties(root, 'Notebook');
	const minor: unknown = getProperty(root, 'nbformat_minor')?.value;
	if (
		getProperty(root, 'nbformat')?.value !== 4 ||
		typeof minor !== 'number' ||
		!Number.isSafeInteger(minor) ||
		minor < 0
	) {
		throw new Error('Only nbformat 4 notebooks are supported.');
	}
	const array = getProperty(root, 'cells');
	if (
		array?.type !== 'array' ||
		getProperty(root, 'metadata')?.type !== 'object'
	) {
		throw new Error(
			'The notebook must have a cells array and metadata object.',
		);
	}
	const ids = new Set<string>();
	const cells = (array.children ?? []).map((node, index) => {
		const label = `Cell ${index}`;
		if (node.type !== 'object') throw new Error(`${label} must be an object.`);
		requireUniqueProperties(node, label);
		const type = stringValue(getProperty(node, 'cell_type'));
		const sourceNode = getProperty(node, 'source');
		if (
			!type ||
			!isTextNode(sourceNode) ||
			getProperty(node, 'metadata')?.type !== 'object'
		) {
			throw new Error(
				`${label} must have a cell type, text source, and metadata object.`,
			);
		}
		const id = stringValue(getProperty(node, 'id'));
		if (minor >= 5 && (!id || !CELL_ID.test(id) || ids.has(id))) {
			throw new Error(`${label} must have a valid, unique cell ID.`);
		}
		if (id) ids.add(id);
		if (type === 'code') {
			const count = getProperty(node, 'execution_count');
			if (
				getProperty(node, 'outputs')?.type !== 'array' ||
				(count?.type !== 'null' &&
					!(
						count?.type === 'number' &&
						Number.isInteger(count.value) &&
						count.value >= 0
					))
			) {
				throw new Error(
					`${label} must have an outputs array and valid execution_count.`,
				);
			}
		}
		return {node, type, id, sourceNode};
	});
	return {text, bom, minor, array, cells};
}

export function validateNotebookRange({
	start_cell,
	end_cell,
	source_offset,
}: NotebookRange): void {
	for (const [name, value] of Object.entries({
		start_cell,
		end_cell,
		source_offset,
	})) {
		if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
			throw new Error(`${name} must be a non-negative integer.`);
		}
	}
	if (end_cell !== undefined && end_cell < (start_cell ?? 0)) {
		throw new Error('end_cell must be >= start_cell.');
	}
	if (
		source_offset !== undefined &&
		(start_cell === undefined || end_cell !== start_cell)
	) {
		throw new Error(
			'Set start_cell and end_cell to the same index when using source_offset.',
		);
	}
}

function nodeBytes(notebook: Notebook, node: Node): number {
	return Buffer.byteLength(
		notebook.text.slice(node.offset, node.offset + node.length),
	);
}

function summarizeOutput(notebook: Notebook, output: Node): string {
	const type = stringValue(getProperty(output, 'output_type'));
	if (type === 'error') {
		const name = stringValue(getProperty(output, 'ename')) ?? 'Error';
		const value = stringValue(getProperty(output, 'evalue')) ?? '';
		return summarizeText(`${name}: ${value}`);
	}
	const data = getProperty(output, 'data');
	const plain =
		type === 'stream'
			? getProperty(output, 'text')
			: getProperty(data, 'text/plain');
	const parts = isTextNode(plain)
		? [summarizeText(notebookTextValue(plain))]
		: [];
	if (data?.type === 'object') {
		const rich = (data.children ?? []).filter(
			property => property.children?.[0]?.value !== 'text/plain',
		);
		for (const property of rich.slice(0, 4)) {
			const [key, value] = property.children ?? [];
			if (key && value) {
				parts.push(
					`[${truncateText(key.value, 70)} omitted, ${nodeBytes(notebook, value)} JSON bytes]`,
				);
			}
		}
		if (rich.length > 4)
			parts.push(`[${rich.length - 4} more MIME entries omitted]`);
	}
	return (
		parts.join('\n') ||
		`[Output omitted, ${nodeBytes(notebook, output)} JSON bytes]`
	);
}

function summarizeText(text: string): string {
	const preview = truncateText(text, OUTPUT_TEXT_LIMIT, {
		ellipsis: '',
		unit: 'code-units',
	});
	return preview === text
		? text
		: `${preview} [${Buffer.byteLength(text) - Buffer.byteLength(preview)} bytes omitted]`;
}

export function formatNotebookRead(
	notebook: Notebook,
	revision: string,
	range: NotebookRange,
): string {
	validateNotebookRange(range);
	const start = range.start_cell ?? 0;
	const count = notebook.cells.length;
	if (
		start >= count &&
		(count > 0 ||
			range.start_cell !== undefined ||
			range.end_cell !== undefined)
	) {
		throw new Error(
			`Cell ${start} is out of range for a notebook with ${count} cells.`,
		);
	}
	const requestedEnd = Math.min(count, (range.end_cell ?? count - 1) + 1);
	const end = Math.min(requestedEnd, start + CELL_PAGE_SIZE);
	const lines = [
		`Jupyter notebook (nbformat 4.${notebook.minor}, ${count} cells)`,
		`Notebook revision: ${revision}`,
	];
	for (let index = start; index < end; index++) {
		const cell = notebook.cells[index];
		const source = notebookTextValue(cell.sourceNode);
		const offset = range.source_offset ?? 0;
		if (offset > source.length)
			throw new Error('source_offset is past the end of the cell source.');
		const view = truncateText(source.slice(offset), SOURCE_PAGE_SIZE, {
			ellipsis: '',
			unit: 'code-units',
		});
		lines.push(
			'',
			`Cell ${index} (${truncateText(cell.type, 70)}${cell.id ? `, id: ${truncateText(cell.id, 64)}` : ''})`,
			'Source:',
			view,
		);
		if (offset + view.length < source.length) {
			lines.push(
				`[More source: read_file with start_cell=${index}, end_cell=${index}, source_offset=${offset + view.length}]`,
			);
		}
		const outputs = getProperty(cell.node, 'outputs')?.children ?? [];
		if (outputs.length) {
			lines.push('Saved outputs:');
			for (const output of outputs.slice(0, OUTPUTS_PER_CELL))
				lines.push(summarizeOutput(notebook, output));
			if (outputs.length > OUTPUTS_PER_CELL)
				lines.push(
					`[${outputs.length - OUTPUTS_PER_CELL} more outputs omitted]`,
				);
		}
	}
	if (end < requestedEnd)
		lines.push(
			'',
			`[More cells: read_file with start_cell=${end}${range.end_cell !== undefined ? `, end_cell=${range.end_cell}` : ''}]`,
		);
	return lines.join('\n');
}
