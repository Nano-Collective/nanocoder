import {constants, existsSync} from 'node:fs';
import {access, copyFile, mkdir, rename, rm, stat} from 'node:fs/promises';
import {dirname, resolve} from 'node:path';
import {makeSimpleToolFormatter} from '@/components/simple-tool-formatter';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {invalidateCache} from '@/utils/file-cache';
import {validatePath, validatePathPair} from '@/utils/path-validators';
import {createFileToolApproval} from '@/utils/tool-approval';

type FileOperation = 'delete' | 'move' | 'copy' | 'mkdir';

interface FileOpArgs {
	operation: FileOperation;
	path?: string;
	destination?: string;
}

const PAIR_OPS = new Set<FileOperation>(['move', 'copy']);

const executeFileOp = async (args: FileOpArgs): Promise<string> => {
	const {operation} = args;

	if (operation === 'mkdir') {
		const absPath = resolve(args.path as string);
		const alreadyExists = existsSync(absPath);
		await mkdir(absPath, {recursive: true});
		return alreadyExists
			? `Directory already exists: ${args.path}`
			: `Directory created: ${args.path}`;
	}

	if (operation === 'delete') {
		const absPath = resolve(args.path as string);
		const fileStat = await stat(absPath);
		if (fileStat.isDirectory()) {
			return `Error: "${args.path}" is a directory. Use execute_bash with rm -r for directory removal.`;
		}
		await rm(absPath);
		invalidateCache(absPath);
		return `File deleted: ${args.path}`;
	}

	// move | copy
	const srcAbsPath = resolve(args.path as string);
	const destAbsPath = resolve(args.destination as string);

	if (operation === 'move') {
		await rename(srcAbsPath, destAbsPath);
		invalidateCache(srcAbsPath);
		return `File moved: ${args.path} → ${args.destination}`;
	}

	await copyFile(srcAbsPath, destAbsPath);
	invalidateCache(destAbsPath);
	return `File copied: ${args.path} → ${args.destination}`;
};

const fileOpCoreTool = tool({
	description:
		'Perform a filesystem operation on a single file or directory. ' +
		'Use this instead of execute_bash for rm/mv/cp/mkdir. ' +
		'operation="delete" removes a file (not directories); ' +
		'operation="move" renames/moves a file; ' +
		'operation="copy" copies a file; ' +
		'operation="mkdir" creates a directory (and any parents). ' +
		'"move" and "copy" require both path (source) and destination.',
	inputSchema: jsonSchema<FileOpArgs>({
		type: 'object',
		properties: {
			operation: {
				type: 'string',
				enum: ['delete', 'move', 'copy', 'mkdir'],
				description: 'The filesystem operation to perform.',
			},
			path: {
				type: 'string',
				description:
					'The target path. For move/copy this is the source file; for delete the file to remove; for mkdir the directory to create.',
			},
			destination: {
				type: 'string',
				description:
					'The destination path. Required for move and copy operations.',
			},
		},
		required: ['operation', 'path'],
	}),
	execute: async (args, _options) => {
		return await executeFileOp(args);
	},
});

const fileOpFormatter = makeSimpleToolFormatter<FileOpArgs>(
	'file_op',
	(args, result) => {
		const rows = [
			{label: 'Operation', value: args.operation},
			{label: 'Path', value: args.path},
		];
		if (PAIR_OPS.has(args.operation)) {
			rows.push({label: 'Destination', value: args.destination});
		}
		rows.push({label: 'Result', value: result || undefined});
		return rows;
	},
);

const fileOpValidator = async (
	args: FileOpArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.operation) {
		return {valid: false, error: '⚒ operation is required'};
	}
	if (!args.path) {
		return {valid: false, error: '⚒ path is required'};
	}

	// Directory creation: only path validation, parents are created.
	if (args.operation === 'mkdir') {
		return validatePath(args.path);
	}

	// delete: path must exist and be a file.
	if (args.operation === 'delete') {
		const pathResult = validatePath(args.path);
		if (!pathResult.valid) return pathResult;

		const absPath = resolve(args.path);
		try {
			await access(absPath, constants.F_OK);
		} catch {
			return {valid: false, error: `⚒ File does not exist: "${args.path}"`};
		}
		return {valid: true};
	}

	// move | copy: need a destination, source must be an existing file,
	// and the destination's parent directory must exist.
	if (!args.destination) {
		return {
			valid: false,
			error: `⚒ destination is required for ${args.operation}`,
		};
	}

	const pairResult = validatePathPair(args.path, args.destination);
	if (!pairResult.valid) return pairResult;

	const srcAbsPath = resolve(args.path);
	try {
		await access(srcAbsPath, constants.F_OK);
	} catch {
		return {
			valid: false,
			error: `⚒ Source file does not exist: "${args.path}"`,
		};
	}

	const fileStat = await stat(srcAbsPath);
	if (fileStat.isDirectory()) {
		return {
			valid: false,
			error: `⚒ Source is a directory, not a file: "${args.path}"`,
		};
	}

	const parentDir = dirname(resolve(args.destination));
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

export const fileOpTool: NanocoderToolExport = {
	name: 'file_op' as const,
	tool: fileOpCoreTool,
	formatter: fileOpFormatter,
	validator: fileOpValidator,
	approval: createFileToolApproval('file_op'),
};
