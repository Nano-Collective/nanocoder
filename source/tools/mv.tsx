import {lstat, rename} from 'node:fs/promises';
import {dirname} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';

import ToolMessage from '@/components/tool-message';
import {getCurrentMode} from '@/context/mode-context';
import {ThemeContext} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {isValidFilePath, resolveFilePath} from '@/utils/path-validation';

interface MvArgs {
	source: string;
	destination: string;
	overwrite?: boolean;
}

const executeMv = async (args: MvArgs): Promise<string> => {
	const {source, destination, overwrite = false} = args;

	// Validate both paths
	if (!isValidFilePath(source)) {
		throw new Error(`Invalid source path: "${source}"`);
	}
	if (!isValidFilePath(destination)) {
		throw new Error(`Invalid destination path: "${destination}"`);
	}

	const cwd = process.cwd();
	const absSource = resolveFilePath(source, cwd);
	const absDestination = resolveFilePath(destination, cwd);

	// Check if source and destination are the same
	if (absSource === absDestination) {
		throw new Error('Source and destination are the same');
	}

	// Check if source exists
	const sourceStats = await lstat(absSource);
	const isSourceDirectory = sourceStats.isDirectory();

	// Check if destination exists
	let destinationExists = false;
	try {
		await lstat(absDestination);
		destinationExists = true;
	} catch {
		// Destination doesn't exist - this is fine
	}

	// Handle existing destination
	if (destinationExists && !overwrite) {
		throw new Error(
			`Destination "${destination}" already exists. Use overwrite=true to replace.`,
		);
	}

	// Perform the move/rename
	await rename(absSource, absDestination);

	// Determine operation type
	const isRename = dirname(absSource) === dirname(absDestination);
	const operationType = isRename ? 'Renamed' : 'Moved';
	const entityType = isSourceDirectory ? 'directory' : 'file';

	return `✓ ${operationType} ${entityType} from "${source}" to "${destination}"`;
};

const mvCoreTool = tool({
	description: 'Move or rename files and directories atomically.',
	inputSchema: jsonSchema<MvArgs>({
		type: 'object',
		properties: {
			source: {
				type: 'string',
				description: 'Source file or directory path',
			},
			destination: {
				type: 'string',
				description: 'Destination path',
			},
			overwrite: {
				type: 'boolean',
				description: 'Overwrite existing destination (default: false)',
			},
		},
		required: ['source', 'destination'],
	}),
	needsApproval: () => {
		const mode = getCurrentMode();
		return mode !== 'auto-accept';
	},
	execute: async (args, _options) => {
		return await executeMv(args);
	},
});

interface MvFormatterProps {
	args: MvArgs;
	result?: string;
}

const MvFormatter = React.memo(({args, result}: MvFormatterProps) => {
	const themeContext = React.useContext(ThemeContext);
	if (!themeContext) {
		throw new Error('ThemeContext is required');
	}
	const {colors} = themeContext;

	const source = args.source || 'unknown';
	const destination = args.destination || 'unknown';
	const overwrite = args.overwrite ?? false;

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>⇄ mv</Text>

			<Box>
				<Text color={colors.secondary}>Source: </Text>
				<Text color={colors.text}>{source}</Text>
			</Box>

			<Box>
				<Text color={colors.secondary}>Destination: </Text>
				<Text color={colors.text}>{destination}</Text>
			</Box>

			<Box>
				<Text color={colors.secondary}>Overwrite: </Text>
				<Text color={colors.text}>{overwrite ? 'yes' : 'no'}</Text>
			</Box>

			{result && (
				<Box marginTop={1}>
					<Text color={colors.text}>{result}</Text>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
});

const mvFormatter = (args: MvFormatterProps['args']): React.ReactElement => {
	return <MvFormatter args={args} />;
};

const mvValidator = async (
	args: MvArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	if (!args.source || args.source.trim().length === 0) {
		return {valid: false, error: 'Source path is required'};
	}
	if (!args.destination || args.destination.trim().length === 0) {
		return {valid: false, error: 'Destination path is required'};
	}

	// Check for same source and destination
	if (args.source === args.destination) {
		return {valid: false, error: 'Source and destination are the same'};
	}

	// Validate both paths
	if (!isValidFilePath(args.source)) {
		return {valid: false, error: `Invalid source path: "${args.source}"`};
	}
	if (!isValidFilePath(args.destination)) {
		return {
			valid: false,
			error: `Invalid destination path: "${args.destination}"`,
		};
	}

	// Check for dangerous patterns
	const dangerousPatterns = [
		/^\s*\/$/, // Root directory
		/^\s*\.\.\/\.\./, // Escaping parent
		/^\s*[A-Za-z]:\\/, // Windows system paths
	];

	for (const pattern of dangerousPatterns) {
		if (pattern.test(args.source) || pattern.test(args.destination)) {
			return {
				valid: false,
				error: `Potentially dangerous path pattern detected`,
			};
		}
	}

	return {valid: true};
};

export const mvTool: NanocoderToolExport = {
	name: 'mv' as const,
	tool: mvCoreTool,
	formatter: mvFormatter,
	validator: mvValidator,
};
