import {randomUUID} from 'node:crypto';
import type {Node} from 'jsonc-parser';
import {truncateText} from '@/utils/truncate-text';
import {collapseUnchangedLines, computeLineDiff} from './inline-diff';
import {
	getProperty,
	NOTEBOOK_CELL_TYPES,
	type Notebook,
	type NotebookCellType,
	notebookTextValue,
} from './notebook';

export const NOTEBOOK_EDIT_OPERATIONS = [
	'replace_source',
	'insert_cell',
	'delete_cell',
	'change_cell_type',
] as const;

export interface EditNotebookArgs {
	path: string;
	operation: (typeof NOTEBOOK_EDIT_OPERATIONS)[number];
	cell_index: number;
	notebook_revision: string;
	source?: string;
	cell_type?: NotebookCellType;
	description?: string;
}

interface NotebookEdit {
	content: string;
	summary: string;
	preview: string;
}

function nodeEnd(node: Node): number {
	return node.offset + node.length;
}

function splice(
	notebook: Notebook,
	start: number,
	end: number,
	replacement = '',
): string {
	return (
		notebook.bom +
		notebook.text.slice(0, start) +
		replacement +
		notebook.text.slice(end)
	);
}

function insertCell(notebook: Notebook, args: EditNotebookArgs): string {
	const {array, cells, minor, text} = notebook;
	const type = args.cell_type;
	const ids = new Set(cells.map(cell => cell.id));
	let id: string;
	do {
		id = randomUUID();
	} while (ids.has(id));
	const encoded = JSON.stringify({
		cell_type: type,
		...(minor >= 5 ? {id} : {}),
		metadata: {},
		source: args.source,
		...(type === 'code' ? {execution_count: null, outputs: []} : {}),
	});
	if (!cells.length)
		return splice(notebook, array.offset + 1, array.offset + 1, encoded);
	const padding = text.slice(array.offset + 1, cells[0].node.offset);
	const next = cells[args.cell_index];
	if (next)
		return splice(
			notebook,
			next.node.offset,
			next.node.offset,
			`${encoded},${padding}`,
		);
	const end = nodeEnd(cells[cells.length - 1].node);
	return splice(notebook, end, end, `,${padding}${encoded}`);
}

function describeLoss(node: Node, fields: readonly string[]): string {
	const outputs = (getProperty(node, 'outputs')?.children ?? []).length;
	const attachments = (getProperty(node, 'attachments')?.children ?? []).length;
	const removed = [];
	if (fields.includes('outputs') && outputs)
		removed.push(`${outputs} saved output(s)`);
	if (fields.includes('attachments') && attachments)
		removed.push(`${attachments} attachment(s)`);
	return removed.length ? ` Removes ${removed.join(' and ')}.` : '';
}

function previewSource(before: string, after: string): string {
	if (before === after) return '';
	// Start close to the first change so an edit late in a long cell is visible.
	let offset = 0;
	while (
		offset < before.length &&
		offset < after.length &&
		before[offset] === after[offset]
	)
		offset++;
	const start = Math.max(0, offset - 120);
	const oldExcerpt = truncateText(before.slice(start), 3000, {
		unit: 'code-units',
	});
	const newExcerpt = truncateText(after.slice(start), 3000, {
		unit: 'code-units',
	});
	return collapseUnchangedLines(computeLineDiff(oldExcerpt, newExcerpt))
		.map(entry => {
			if (entry.type === 'gap') return `  … ${entry.count} unchanged line(s)`;
			const prefix =
				entry.type === 'added' ? '+' : entry.type === 'removed' ? '-' : ' ';
			return `${prefix} ${entry.text}`;
		})
		.join('\n');
}

export function planNotebookEdit(
	notebook: Notebook,
	args: EditNotebookArgs,
): NotebookEdit {
	const {operation, cell_index: index, source, cell_type: targetType} = args;
	if (!NOTEBOOK_EDIT_OPERATIONS.includes(operation))
		throw new Error('Unsupported notebook operation.');
	const inserting = operation === 'insert_cell';
	const maxIndex = notebook.cells.length - (inserting ? 0 : 1);
	if (!Number.isSafeInteger(index) || index < 0 || index > maxIndex) {
		throw new Error(
			`cell_index is out of range for a notebook with ${notebook.cells.length} cells.`,
		);
	}
	if (
		(inserting || operation === 'replace_source') &&
		typeof source !== 'string'
	) {
		throw new Error('source is required for insert_cell and replace_source.');
	}
	if (
		(inserting || operation === 'change_cell_type') &&
		(!targetType || !NOTEBOOK_CELL_TYPES.includes(targetType))
	) {
		throw new Error(
			'cell_type must be code, markdown, or raw for insert_cell and change_cell_type.',
		);
	}
	if (inserting) {
		const summary = `Insert ${targetType} cell at index ${index}.`;
		return {
			content: insertCell(notebook, args),
			summary,
			preview: previewSource('', source ?? ''),
		};
	}

	const cell = notebook.cells[index];
	const {node, sourceNode, type} = cell;
	const label = `cell ${index} (${truncateText(type, 70)}${cell.id ? `, id: ${truncateText(cell.id, 64)}` : ''})`;
	const oldSource = notebookTextValue(sourceNode);
	switch (operation) {
		case 'replace_source': {
			const newSource = source ?? '';
			const encoded = JSON.stringify(
				sourceNode.type === 'array'
					? newSource
						? newSource.split(/(?<=\n)/)
						: []
					: newSource,
			);
			const content =
				newSource === oldSource
					? notebook.bom + notebook.text
					: splice(notebook, sourceNode.offset, nodeEnd(sourceNode), encoded);
			const outputNote =
				(getProperty(node, 'outputs')?.children?.length ?? 0) > 0 &&
				oldSource !== newSource
					? ' Saved outputs are from the previous execution.'
					: '';
			return {
				content,
				summary: `Replace source in ${label}.${outputNote}`,
				preview: previewSource(oldSource, newSource),
			};
		}
		case 'delete_cell': {
			const previous = notebook.cells[index - 1];
			const next = notebook.cells[index + 1];
			const start = previous && !next ? nodeEnd(previous.node) : node.offset;
			const end = next ? next.node.offset : nodeEnd(node);
			return {
				content: splice(notebook, start, end),
				summary: `Delete ${label}.${describeLoss(node, ['outputs', 'attachments'])}`,
				preview: previewSource(oldSource, ''),
			};
		}
		case 'change_cell_type': {
			if (type === targetType)
				return {
					content: notebook.bom + notebook.text,
					summary: `${label} already has type ${targetType}.`,
					preview: '',
				};
			if (!NOTEBOOK_CELL_TYPES.some(knownType => knownType === type)) {
				throw new Error(
					`Cannot convert an unrecognized cell type (${truncateText(type, 70)}).`,
				);
			}
			const removed =
				targetType === 'code'
					? ['attachments']
					: ['outputs', 'execution_count'];
			// Keep the original source, metadata, ID and other retained property bytes.
			const properties = (node.children ?? []).flatMap(property => {
				const key = property.children?.[0]?.value;
				if (removed.includes(key)) return [];
				return key === 'cell_type'
					? [`"cell_type":${JSON.stringify(targetType)}`]
					: [notebook.text.slice(property.offset, nodeEnd(property))];
			});
			if (targetType === 'code')
				properties.push('"execution_count":null', '"outputs":[]');
			return {
				content: splice(
					notebook,
					node.offset,
					nodeEnd(node),
					`{${properties.join(',')}}`,
				),
				summary: `Change ${label} to ${targetType}.${describeLoss(node, removed)}`,
				preview: truncateText(oldSource, 3000, {unit: 'code-units'}),
			};
		}
	}
}
