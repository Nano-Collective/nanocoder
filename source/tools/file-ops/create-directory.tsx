import {existsSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {makeSimpleToolFormatter} from '@/components/simple-tool-formatter';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {validatePath} from '@/utils/path-validators';

interface CreateDirectoryArgs {
	path: string;
}

const executeCreateDirectory = async (
	args: CreateDirectoryArgs,
): Promise<string> => {
	const absPath = resolve(args.path);
	const alreadyExists = existsSync(absPath);

	await mkdir(absPath, {recursive: true});

	if (alreadyExists) {
		return `Directory already exists: ${args.path}`;
	}
	return `Directory created: ${args.path}`;
};

const createDirectoryCoreTool = tool({
	description:
		'Create a directory, including parent directories if needed. Idempotent — succeeds if the directory already exists.',
	inputSchema: jsonSchema<CreateDirectoryArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description:
					'The relative path of the directory to create (e.g., "src/components/new-feature").',
			},
		},
		required: ['path'],
	}),
	execute: async (args, _options) => {
		return await executeCreateDirectory(args);
	},
});

const createDirectoryFormatter = makeSimpleToolFormatter<CreateDirectoryArgs>(
	'create_directory',
	(args, result) => [
		{label: 'Path', value: args.path},
		{label: 'Result', value: result || undefined},
	],
);

const createDirectoryValidator = async (
	args: CreateDirectoryArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	return validatePath(args.path);
};

export const createDirectoryTool: NanocoderToolExport = {
	name: 'create_directory' as const,
	tool: createDirectoryCoreTool,
	formatter: createDirectoryFormatter,
	validator: createDirectoryValidator,
	// Low risk: creating directories is non-destructive and idempotent
	approval: false,
};
