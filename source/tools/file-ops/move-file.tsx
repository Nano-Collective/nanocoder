import {constants} from 'node:fs';
import {access, rename, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {makeSimpleToolFormatter} from '@/components/simple-tool-formatter';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {invalidateCache} from '@/utils/file-cache';
import {validatePathPair} from '@/utils/path-validators';
import {createFileToolApproval} from '@/utils/tool-approval';

interface MoveFileArgs {
	source: string;
	destination: string;
}

const executeMoveFile = async (args: MoveFileArgs): Promise<string> => {
	const srcAbsPath = resolve(args.source);
	const destAbsPath = resolve(args.destination);

	await rename(srcAbsPath, destAbsPath);
	invalidateCache(srcAbsPath);

	return `File moved: ${args.source} → ${args.destination}`;
};

const moveFileCoreTool = tool({
	description:
		'Move or rename a file. Use this instead of execute_bash with mv.',
	inputSchema: jsonSchema<MoveFileArgs>({
		type: 'object',
		properties: {
			source: {
				type: 'string',
				description: 'The current relative path of the file.',
			},
			destination: {
				type: 'string',
				description: 'The new relative path for the file.',
			},
		},
		required: ['source', 'destination'],
	}),
	execute: async (args, _options) => {
		return await executeMoveFile(args);
	},
});

const moveFileFormatter = makeSimpleToolFormatter<MoveFileArgs>(
	'move_file',
	(args, result) => [
		{label: 'Source', value: args.source},
		{label: 'Destination', value: args.destination},
		{label: 'Result', value: result || undefined},
	],
);

const moveFileValidator = async (
	args: MoveFileArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const pathResult = validatePathPair(args.source, args.destination);
	if (!pathResult.valid) return pathResult;

	// Check source exists
	const srcAbsPath = resolve(args.source);
	try {
		await access(srcAbsPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ Source file does not exist: "${args.source}"`,
		};
	}

	// Check source is a file
	const fileStat = await stat(srcAbsPath);
	if (fileStat.isDirectory()) {
		return {
			valid: false,
			error: `⚒ Source is a directory, not a file: "${args.source}"`,
		};
	}

	// Check destination parent directory exists
	const destAbsPath = resolve(args.destination);
	const parentDir = dirname(destAbsPath);
	try {
		await access(parentDir, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ Destination parent directory does not exist: "${parentDir}"`,
		};
	}

	return {valid: true};
};

export const moveFileTool: NanocoderToolExport = {
	name: 'move_file' as const,
	tool: moveFileCoreTool,
	formatter: moveFileFormatter,
	validator: moveFileValidator,
	approval: createFileToolApproval('move_file'),
};
