import {realpath} from 'node:fs/promises';
import {resolve} from 'node:path';
import ToolMessage from '@/components/tool-message';
import {
	enforceFirewall,
	evaluateMutationEnvelope,
} from '@/firewall/mutation-firewall';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {
	forgetReadContent,
	forgetVisibilityReceipt,
	hasSeenFile,
} from '@/tools/runtime/read-tracker';
import {createFileToolApproval} from '@/tools/runtime/tool-approval';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {atomicWriteUserFile} from '@/utils/fs/atomic-write';
import {invalidateCache} from '@/utils/fs/file-cache';
import {normalizeForCompare} from '@/utils/fs/path-validation';
import {
	getNotebookRevision,
	isNotebookPath,
	NOTEBOOK_CELL_TYPES,
	parseNotebook,
	readNotebookText,
} from './notebook';
import {
	type EditNotebookArgs,
	NOTEBOOK_EDIT_OPERATIONS,
	planNotebookEdit,
} from './notebook-edit';
import {validatePath} from './path-validators';

const activeEdits = new Set<string>();

function resolveNotebookEditPath(path: string): string {
	if (typeof path !== 'string' || !isNotebookPath(path)) {
		throw new Error('Provide the path to an existing .ipynb notebook.');
	}
	const pathResult = validatePath(path);
	if (!pathResult.valid) throw new Error(pathResult.error);
	const absPath = resolve(getSafeSessionCwd(), path);
	if (!hasSeenFile(absPath)) {
		throw new Error(`Read "${path}" with read_file before editing it.`);
	}
	return absPath;
}

async function prepareNotebookEdit(absPath: string, args: EditNotebookArgs) {
	const original = await readNotebookText(absPath);
	if (args.notebook_revision !== getNotebookRevision(original)) {
		throw new Error(
			'The notebook revision is missing, stale, or incorrect. Call read_file again and use the current revision.',
		);
	}
	const plan = planNotebookEdit(await parseNotebook(original), args);
	return {original, ...plan};
}

export async function getNotebookEditPreview(
	args: EditNotebookArgs,
): Promise<string> {
	const plan = await prepareNotebookEdit(
		resolveNotebookEditPath(args.path),
		args,
	);
	return [plan.summary, plan.preview].filter(Boolean).join('\n');
}

async function executeNotebookEdit(args: EditNotebookArgs): Promise<string> {
	const absPath = resolveNotebookEditPath(args.path);
	const target = await realpath(absPath);
	const editKey = normalizeForCompare(target);
	if (activeEdits.has(editKey))
		throw new Error(
			'Another edit is in progress for this notebook. Read it again before retrying.',
		);
	activeEdits.add(editKey);
	try {
		const {original, content, summary} = await prepareNotebookEdit(
			target,
			args,
		);
		if (content === original) return `No changes. ${summary}`;
		await parseNotebook(content);
		const warning = enforceFirewall(
			evaluateMutationEnvelope(args.path, original, content),
		);
		// Recheck close to the write to catch a Jupyter autosave after preparation.
		if (
			(await realpath(resolveNotebookEditPath(args.path))) !== target ||
			(await readNotebookText(target)) !== original
		) {
			throw new Error(
				'The notebook changed before the edit could be saved. Call read_file again.',
			);
		}
		await atomicWriteUserFile(target, content);
		for (const path of new Set([target, absPath])) {
			invalidateCache(path);
			forgetReadContent(path);
			forgetVisibilityReceipt(path);
		}
		return `Notebook updated. ${summary}\nNotebook revision: ${getNotebookRevision(content)}${warning}`;
	} finally {
		activeEdits.delete(editKey);
	}
}

const editNotebookCoreTool = tool({
	description:
		'Edit one cell in an existing Jupyter .ipynb notebook. Read the notebook with read_file first to get cell indexes and the current revision. Replace source, insert, delete, or change the cell type. Unedited cells retain their original bytes.',
	inputSchema: jsonSchema<EditNotebookArgs>({
		type: 'object',
		properties: {
			path: {type: 'string', description: 'Path to the .ipynb notebook.'},
			operation: {type: 'string', enum: [...NOTEBOOK_EDIT_OPERATIONS]},
			cell_index: {
				type: 'integer',
				description:
					'Zero-based cell index. insert_cell inserts before this index, or appends at the cell count.',
			},
			notebook_revision: {
				type: 'string',
				description:
					'The notebook revision from the latest read_file or edit_notebook result.',
			},
			source: {
				type: 'string',
				description:
					'Full cell source. Required for replace_source and insert_cell. An empty string is valid.',
			},
			cell_type: {
				type: 'string',
				enum: [...NOTEBOOK_CELL_TYPES],
				description: 'Required for insert_cell and change_cell_type.',
			},
			description: {
				type: 'string',
				description: 'Optional brief description of the edit.',
			},
		},
		required: ['path', 'operation', 'cell_index', 'notebook_revision'],
	}),
	execute: async (args, _options) => executeNotebookEdit(args),
});

export const editNotebookTool: NanocoderToolExport = {
	name: 'edit_notebook',
	tool: editNotebookCoreTool,
	validator: async (args: EditNotebookArgs) => {
		try {
			await prepareNotebookEdit(resolveNotebookEditPath(args.path), args);
			return {valid: true};
		} catch (error) {
			return {valid: false, error: formatError(error)};
		}
	},
	formatter: async (args: EditNotebookArgs, result?: string) => {
		const body =
			result ?? (await getNotebookEditPreview(args).catch(formatError));
		return (
			<ToolMessage
				title="edit_notebook"
				message={[args.path, args.description, body].filter(Boolean).join('\n')}
			/>
		);
	},
	approval: createFileToolApproval<EditNotebookArgs>('edit_notebook', {
		isIrreversible: args =>
			args.operation === 'delete_cell' || args.operation === 'change_cell_type',
	}),
};
