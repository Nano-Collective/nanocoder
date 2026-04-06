import {Box, Text} from 'ink';
import React from 'react';

import {getBraveSearchApiKey} from '@/config/nanocoder-tools-config';
import {
	DEFAULT_WEB_SEARCH_RESULTS,
	MAX_WEB_SEARCH_QUERY_LENGTH,
	TIMEOUT_WEB_SEARCH_MS,
} from '@/constants';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {calculateTokens} from '@/utils/token-calculator';

interface SearchArgs {
	query: string;
	max_results?: number;
}

interface BraveSearchResult {
	title: string;
	url: string;
	description?: string;
}

interface BraveSearchResponse {
	web?: {
		results?: BraveSearchResult[];
	};
}

export const executeWebSearch = async (
	args: SearchArgs,
	apiKeyOverride?: string,
): Promise<string> => {
	const apiKey = apiKeyOverride ?? getBraveSearchApiKey();
	if (!apiKey) {
		throw new Error(
			'Brave Search API key not configured. Add it to agents.config.json under nanocoderTools.webSearch.apiKey',
		);
	}

	const maxResults = args.max_results ?? DEFAULT_WEB_SEARCH_RESULTS;
	const encodedQuery = encodeURIComponent(args.query);

	try {
		const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodedQuery}&count=${maxResults}`;

		const response = await fetch(searchUrl, {
			headers: {
				Accept: 'application/json',
				'Accept-Encoding': 'gzip',
				'X-Subscription-Token': apiKey,
			},
			signal: AbortSignal.timeout(TIMEOUT_WEB_SEARCH_MS),
		});

		if (response.status === 401 || response.status === 403) {
			throw new Error('Invalid Brave Search API key');
		}

		if (response.status === 429) {
			throw new Error('Brave Search API rate limit exceeded');
		}

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const data = (await response.json()) as BraveSearchResponse;
		const results = data.web?.results ?? [];

		if (results.length === 0) {
			return `No results found for query: "${args.query}"`;
		}

		let formattedResults = `# Web Search Results: "${args.query}"\n\n`;

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (!result) continue;
			formattedResults += `## ${i + 1}. ${result.title}\n\n`;
			formattedResults += `**URL:** ${result.url}\n\n`;
			if (result.description) {
				formattedResults += `${result.description}\n\n`;
			}
			formattedResults += '---\n\n';
		}

		return formattedResults;
	} catch (error: unknown) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error('Search request timeout');
		}

		if (error instanceof Error) {
			throw error;
		}

		throw new Error(`Web search failed: Unknown error`);
	}
};

const webSearchCoreTool = tool({
	description:
		'Search the web and return results as markdown. Use for finding documentation, API references, error solutions, and current information.',
	inputSchema: jsonSchema<SearchArgs>({
		type: 'object',
		properties: {
			query: {
				type: 'string',
				description: 'The search query.',
			},
			max_results: {
				type: 'number',
				description:
					'Maximum number of search results to return (default: 10).',
			},
		},
		required: ['query'],
	}),
	// Low risk: read-only operation, never requires approval
	needsApproval: false,
	execute: async (args, _options) => {
		return await executeWebSearch(args);
	},
});

function WebSearchFormatterComponent({
	query,
	maxResults,
	result,
}: {
	query: string;
	maxResults: number;
	result?: string;
}): React.ReactElement {
	const boxWidth = useTerminalWidth();
	const {colors} = useTheme();

	// Parse result to count actual results
	let resultCount = 0;
	let estimatedTokens = 0;
	if (result) {
		const matches = result.match(/^## \d+\./gm);
		resultCount = matches ? matches.length : 0;
		estimatedTokens = calculateTokens(result);
	}

	return (
		<Box flexDirection="column" marginBottom={1} width={boxWidth}>
			<Text color={colors.tool}>⚒ web_search</Text>
			<Box>
				<Text color={colors.secondary}>Query: </Text>
				<Box marginLeft={1} flexShrink={1}>
					<Text wrap="truncate-end" color={colors.text}>
						{query}
					</Text>
				</Box>
			</Box>
			<Box>
				<Text color={colors.secondary}>Engine: </Text>
				<Text color={colors.text}>Brave Search API</Text>
			</Box>
			{result && (
				<>
					<Box>
						<Text color={colors.secondary}>Results: </Text>
						<Text color={colors.text}>
							{resultCount} / {maxResults} results
						</Text>
					</Box>
					<Box>
						<Text color={colors.secondary}>Output: </Text>
						<Text color={colors.text}>~{estimatedTokens} tokens</Text>
					</Box>
				</>
			)}
		</Box>
	);
}

export const webSearchFormatter = (
	args: SearchArgs,
	result?: string,
): React.ReactElement => {
	return (
		<WebSearchFormatterComponent
			query={args.query || 'unknown'}
			maxResults={args.max_results ?? DEFAULT_WEB_SEARCH_RESULTS}
			result={result}
		/>
	);
};

export const webSearchValidator = (
	args: SearchArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	const query = args.query?.trim();

	// Check if query is empty
	if (!query) {
		return Promise.resolve({
			valid: false,
			error: '⚒ Search query cannot be empty',
		});
	}

	// Check query length (reasonable limit)
	if (query.length > MAX_WEB_SEARCH_QUERY_LENGTH) {
		return Promise.resolve({
			valid: false,
			error: `⚒ Search query is too long (${query.length} characters). Maximum length is ${MAX_WEB_SEARCH_QUERY_LENGTH} characters.`,
		});
	}

	return Promise.resolve({valid: true});
};

export const webSearchTool: NanocoderToolExport = {
	name: 'web_search' as const,
	tool: webSearchCoreTool,
	formatter: webSearchFormatter,
	validator: webSearchValidator,
	readOnly: true,
};
