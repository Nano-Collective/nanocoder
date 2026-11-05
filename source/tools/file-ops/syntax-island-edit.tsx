import {writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {Box, Text} from 'ink';
import React from 'react';
import ToolMessage, {CappedLines} from '@/components/tool-message';
import {getColors} from '@/config/index';
import {ThemeContext} from '@/hooks/useTheme';
import {getSafeSessionCwd} from '@/services/session-cwd';
import {findSyntaxIsland} from '@/syntax-island/island-extractor';
import {spliceSyntaxIsland} from '@/syntax-island/island-splicer';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {getCachedFileContent, invalidateCache} from '@/utils/file-cache';
import {validateEditableFormat, validatePath} from '@/utils/path-validators';
import {
	forgetReadContent,
	hasSeenFile,
	markFileSeen,
} from '@/utils/read-tracker';
import {createFileToolApproval} from '@/utils/tool-approval';
import {
	closeDiffInVSCode,
	isVSCodeConnected,
	sendFileChangeToVSCode,
} from '@/vscode/index';

export interface SyntaxIslandEditArgs {
	path: string;
	symbol: string;
	new_body: string;
	description?: string;
}

const executeSyntaxIslandEdit = async (
	args: SyntaxIslandEditArgs,
): Promise<string> => {
	const {path, symbol, new_body} = args;

	if (!symbol || !symbol.trim()) {
		throw new Error(
			'symbol cannot be empty. Provide the function, method, or component name.',
		);
	}

	const formatResult = validateEditableFormat(path);
	if (!formatResult.valid) {
		throw new Error(formatResult.error);
	}

	const absPath = resolve(getSafeSessionCwd(), path);
	const cached = await getCachedFileContent(absPath);
	const fileContent = cached.content;

	const extraction = findSyntaxIsland(fileContent, symbol);
	if (!extraction.found || !extraction.island) {
		throw new Error(
			extraction.error ??
				`Symbol '${symbol}' was not found in ${path}. The file may have changed since you last read it.`,
		);
	}

	const splicing = spliceSyntaxIsland(fileContent, extraction.island, new_body);
	if (!splicing.success || !splicing.newContent) {
		throw new Error(
			splicing.error ?? `Failed to splice syntax island '${symbol}'.`,
		);
	}

	await writeFile(absPath, splicing.newContent, 'utf-8');
	invalidateCache(absPath);
	markFileSeen(absPath);
	forgetReadContent(absPath);

	const {island} = extraction;
	return `Successfully updated syntax island '${symbol}' (${island.kind}) at lines ${island.startLine}-${island.endLine}. All outer code and imports were preserved byte-for-byte.`;
};

const syntaxIslandEditCoreTool = tool({
	description:
		'Edit an isolated syntax island (function body, method, component, arrow function) by symbol name. The harness locks and preserves all outer scaffolding, imports, and sibling functions byte-for-byte, eliminating syntax breakage and misplaced brackets.',
	inputSchema: jsonSchema<SyntaxIslandEditArgs>({
		type: 'object',
		properties: {
			path: {
				type: 'string',
				description: 'The path to the file to edit.',
			},
			symbol: {
				type: 'string',
				description:
					'The name of the target function, method, class, or component (e.g. "validateUser", "handleSubmit").',
			},
			new_body: {
				type: 'string',
				description:
					'The replacement code body for the isolated symbol (statements inside the function/method).',
			},
			description: {
				type: 'string',
				description:
					'Optional brief summary of the intent or purpose of this replacement.',
			},
		},
		required: ['path', 'symbol', 'new_body'],
		additionalProperties: false,
	}),
	execute: async args => {
		return await executeSyntaxIslandEdit(args);
	},
});

function SyntaxIslandEditComponent({
	args,
	result,
}: {
	args: SyntaxIslandEditArgs;
	result?: string;
}) {
	const themeContext = React.useContext(ThemeContext);
	const colors = themeContext?.colors ?? getColors();
	const {path, symbol, new_body, description} = args;

	const bodyLines = new_body.split('\n').map(line => ({
		text: `+ ${line}`,
		color: colors.success,
		changed: true,
	}));

	const messageContent = (
		<Box flexDirection="column">
			<Text color={colors.tool}>syntax_island_edit</Text>
			{description && (
				<Box flexDirection="column">
					<Text color={colors.secondary}>Description:</Text>
					<Text color={colors.text}> {description}</Text>
				</Box>
			)}
			<Box>
				<Text color={colors.secondary}>Target: </Text>
				<Text color={colors.text}>
					{path} → <Text color="yellow">{symbol}</Text>
				</Text>
			</Box>
			{result ? (
				<Text color={colors.success}>{result}</Text>
			) : (
				<Box flexDirection="column" marginTop={1}>
					<CappedLines
						items={bodyLines}
						isChange={row => row.changed}
						renderItem={(row, index) => (
							<Text key={index} color={row.color}>
								{row.text}
							</Text>
						)}
					/>
				</Box>
			)}
		</Box>
	);

	return <ToolMessage message={messageContent} hideBox={true} />;
}

const vscodeChangeIds = new Map<string, string>();

const syntaxIslandEditFormatter = async (
	args: SyntaxIslandEditArgs,
	result?: string,
): Promise<React.ReactElement> => {
	const {path, symbol, new_body} = args;
	const absPath = resolve(getSafeSessionCwd(), path);

	if (result === undefined && isVSCodeConnected()) {
		try {
			const cached = await getCachedFileContent(absPath);
			const fileContent = cached.content;
			const extraction = findSyntaxIsland(fileContent, symbol);
			if (extraction.found && extraction.island) {
				const splicing = spliceSyntaxIsland(
					fileContent,
					extraction.island,
					new_body,
				);
				if (splicing.success && splicing.newContent) {
					const changeId = sendFileChangeToVSCode(
						absPath,
						fileContent,
						splicing.newContent,
						'syntax_island_edit',
						{path, symbol, new_body},
					);
					if (changeId) {
						vscodeChangeIds.set(absPath, changeId);
					}
				}
			}
		} catch {
			// Silently ignore errors sending to VS Code
		}
	} else if (result !== undefined && isVSCodeConnected()) {
		const changeId = vscodeChangeIds.get(absPath);
		if (changeId) {
			closeDiffInVSCode(changeId);
			vscodeChangeIds.delete(absPath);
		}
	}

	return <SyntaxIslandEditComponent args={args} result={result} />;
};

const syntaxIslandEditValidator = async (
	args: SyntaxIslandEditArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const {path, symbol} = args;

	if (!path) return {valid: false, error: 'Path is required'};
	if (!symbol) return {valid: false, error: 'Symbol is required'};

	const pathResult = validatePath(path);
	if (!pathResult.valid) return pathResult;

	const formatResult = validateEditableFormat(path);
	if (!formatResult.valid) return formatResult;

	const absPath = resolve(getSafeSessionCwd(), path);
	if (!hasSeenFile(absPath)) {
		return {
			valid: false,
			error: `File ${path} must be read before editing. Use read_file first.`,
		};
	}

	try {
		const cached = await getCachedFileContent(absPath);
		const extraction = findSyntaxIsland(cached.content, symbol);
		if (!extraction.found) {
			return {
				valid: false,
				error: extraction.error ?? `Symbol '${symbol}' not found in ${path}.`,
			};
		}
	} catch (error) {
		return {
			valid: false,
			error: `Error reading file "${path}": ${formatError(error)}`,
		};
	}

	return {valid: true};
};

export const syntaxIslandEditTool: NanocoderToolExport = {
	name: 'syntax_island_edit' as const,
	tool: syntaxIslandEditCoreTool,
	formatter: syntaxIslandEditFormatter,
	validator: syntaxIslandEditValidator,
	approval: createFileToolApproval('syntax_island_edit'),
};
