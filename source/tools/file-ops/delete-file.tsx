import {constants} from 'node:fs';
import {access, rm, stat} from 'node:fs/promises';
import {resolve} from 'node:path';
import {makeSimpleToolFormatter} from '@/components/simple-tool-formatter';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {invalidateCache} from '@/utils/file-cache';
import {validatePath} from '@/utils/path-validators';
import {createFileToolApproval} from '@/utils/tool-approval';

interface DeleteFileArgs {
	path: string;
}

const executeDeleteFile = async (args: DeleteFileArgs): Promise<string> => {
	const absPath = resolve(args.path);

	const fileStat = await stat(absPath);
	if (fileStat.isDirectory()) {
		return `Error: "${args.path}" is a directory. Use execute_bash with rm -r for directory removal.`;
	}

	await rm(absPath);
	invalidateCache(absPath);

	return `File deleted: ${args.path}`;
};

const deleteFileCoreTool = tool({
	description: 'Delete a file. Only deletes single files, not directories.',
	inputSchema: jsonSchema<DeleteFileArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The relative path to the file to delete.',
			},
		},
		required: ['path'],
	}),
	execute: async (args, _options) => {
		return await executeDeleteFile(args);
	},
});

const deleteFileFormatter = makeSimpleToolFormatter<DeleteFileArgs>(
	'delete_file',
	(args, result) => [
		{label: 'Path', value: args.path},
		{label: 'Result', value: result || undefined},
	],
);

const deleteFileValidator = async (
	args: DeleteFileArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const pathResult = validatePath(args.path);
	if (!pathResult.valid) return pathResult;

	const absPath = resolve(args.path);

	try {
		await access(absPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ File does not exist: "${args.path}"`,
		};
	}

	return {valid: true};
};

export const deleteFileTool: NanocoderToolExport = {
	name: 'delete_file' as const,
	tool: deleteFileCoreTool,
	formatter: deleteFileFormatter,
	validator: deleteFileValidator,
	approval: createFileToolApproval('delete_file'),
};
