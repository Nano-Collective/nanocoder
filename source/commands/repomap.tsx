import {Box, Text} from 'ink';
import React from 'react';
import {TitledBoxWithPreferences} from '@/components/ui/titled-box';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {
	buildRepoMap,
	DEFAULT_REPO_MAP_TOKENS,
	type RepoMap,
} from '@/repo-map/index';
import {generateKey} from '@/session/key-generator';
import type {Command} from '@/types/index';
import {errorMsg} from '@/utils/message-factory';

const MIN_TOKENS = 64;
const MAX_TOKENS = 32_000;
const TOKENS_FLAG_PREFIX = '--tokens=';

export function parseRepoMapArgs(args: string[]): {
	maxTokens: number;
	error?: string;
} {
	let maxTokens = DEFAULT_REPO_MAP_TOKENS;

	for (let index = 0; index < args.length; index++) {
		const arg = args[index];
		if (arg !== '--tokens' && !arg.startsWith(TOKENS_FLAG_PREFIX)) {
			return {maxTokens, error: `Unknown argument: ${arg}`};
		}
		const inline =
			arg === '--tokens' ? undefined : arg.slice(TOKENS_FLAG_PREFIX.length);
		const raw = inline ?? args[++index];
		const parsed = Number(raw);
		if (!raw || !Number.isFinite(parsed) || parsed < MIN_TOKENS) {
			return {
				maxTokens,
				error: `--tokens expects a number of at least ${MIN_TOKENS}`,
			};
		}
		maxTokens = Math.min(Math.floor(parsed), MAX_TOKENS);
	}

	return {maxTokens};
}

export function RepoMapView({map}: {map: RepoMap}) {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	return (
		<TitledBoxWithPreferences
			title="/repomap"
			width={boxWidth}
			borderColor={colors.primary}
			paddingX={2}
			paddingY={1}
			flexDirection="column"
			marginBottom={1}
		>
			{map.files.length === 0 ? (
				<Text color={colors.secondary}>
					No indexable source files found in this directory.
				</Text>
			) : (
				<>
					<Box marginBottom={1}>
						<Text color={colors.primary}>
							Top {map.files.length} of {map.scannedFiles} files ·{' '}
							{map.totalSymbols} symbols
							{map.truncated ? ' · truncated' : ''}
						</Text>
					</Box>
					{map.files.map(file => (
						<Box key={file.path} flexDirection="column" marginBottom={1}>
							<Text color={colors.text} bold>
								{file.path}
							</Text>
							<Text color={colors.secondary}>{file.symbols.join(', ')}</Text>
						</Box>
					))}
				</>
			)}
		</TitledBoxWithPreferences>
	);
}

export const repomapCommand: Command = {
	name: 'repomap',
	description:
		'Show a ranked map of the codebase (files and their key symbols). Use --tokens <n> to widen it.',
	progressLabel: 'Building repo map',
	handler: async (args, _messages, _metadata) => {
		const {maxTokens, error} = parseRepoMapArgs(args);
		if (error) {
			return errorMsg(`${error}\n\nUsage: /repomap [--tokens <n>]`, 'repomap');
		}

		try {
			const map = await buildRepoMap(process.cwd(), {maxTokens});
			return React.createElement(RepoMapView, {
				key: generateKey('repomap'),
				map,
			});
		} catch (buildError) {
			return errorMsg(
				`Failed to build repo map: ${
					buildError instanceof Error ? buildError.message : String(buildError)
				}`,
				'repomap',
			);
		}
	},
};
