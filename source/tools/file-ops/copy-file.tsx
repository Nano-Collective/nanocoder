import {constants} from 'node:fs';
import {access, copyFile, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {makeSimpleToolFormatter} from '@/components/simple-tool-formatter';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {invalidateCache} from '@/utils/file-cache';
import {validatePathPair} from '@/utils/path-validators';
import {createFileToolApproval} from '@/utils/tool-approval';

interface CopyFileArgs {
	source: string;
	destination: string;
}

const executeCopyFile = async (args: CopyFileArgs): Promise<string> => {
	const srcAbsPath = resolve(args.source);
	const destAbsPath = resolve(args.destination);

	await copyFile(srcAbsPath, destAbsPath);
	invalidateCache(destAbsPath);

	return `File copied: ${args.source} → ${args.destination}`;
};

const copyFileCoreTool = tool({
	description:
		'Copy a file to a new location. Use this instead of execute_bash with cp.',
	inputSchema: jsonSchema<CopyFileArgs>({
		type: 'object',
		properties: {
			source: {
				type: 'string',
				description: 'The relative path of the file to copy.',
			},
			destination: {
				type: 'string',
				description: 'The relative path for the copy.',
			},
		},
		required: ['source', 'destination'],
	}),
	execute: async (args, _options) => {
		return await executeCopyFile(args);
	},
});

const copyFileFormatter = makeSimpleToolFormatter<CopyFileArgs>(
	'copy_file',
	(args, result) => [
		{label: 'Source', value: args.source},
		{label: 'Destination', value: args.destination},
		{label: 'Result', value: result || undefined},
	],
);

const copyFileValidator = async (
	args: CopyFileArgs,
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

export const copyFileTool: NanocoderToolExport = {
	name: 'copy_file' as const,
	tool: copyFileCoreTool,
	formatter: copyFileFormatter,
	validator: copyFileValidator,
	approval: createFileToolApproval('copy_file'),
};
