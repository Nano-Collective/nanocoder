import {Box, Text} from 'ink';
import React from 'react';

import {
	describeWebSearchEngine,
	getWebSearchStatus,
	type WebSearchSettings,
} from '@/config/nanocoder-tools-config';
import {
	DEFAULT_WEB_SEARCH_RESULTS,
	MAX_WEB_SEARCH_QUERY_LENGTH,
	TIMEOUT_WEB_SEARCH_MS,
} from '@/constants';
import {useTerminalWidth} from '@/hooks/useTerminalWidth';
import {useTheme} from '@/hooks/useTheme';
import {assertResolvedPublicHttpUrl} from '@/tools/fetch-url-guard';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {estimateTokens} from '@/utils/token-calculator';

interface SearchArgs {
	query: string;
	max_results?: number;
}

/** One result, the same shape whichever engine found it. */
interface SearchResult {
	title: string;
	url: string;
	description?: string;
}

interface BraveSearchResponse {
	web?: {
		results?: SearchResult[];
	};
}

interface SearxngSearchResponse {
	results?: Array<{title?: string; url?: string; content?: string}>;
}

async function searchBrave(
	query: string,
	maxResults: number,
	settings: WebSearchSettings,
): Promise<SearchResult[]> {
	if (!settings.apiKey) {
		throw new Error(
			'Brave Search API key not configured. Add it to agents.config.json under nanocoderTools.webSearch.apiKey',
		);
	}

	const searchUrl = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;
	const response = await fetch(searchUrl, {
		headers: {
			Accept: 'application/json',
			'Accept-Encoding': 'gzip',
			'X-Subscription-Token': settings.apiKey,
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
	return data.web?.results ?? [];
}

async function searchSearxng(
	query: string,
	maxResults: number,
	settings: WebSearchSettings,
): Promise<SearchResult[]> {
	if (!settings.baseUrl) {
		throw new Error(
			'SearXNG base URL not configured. Add it to agents.config.json under nanocoderTools.webSearch.baseUrl',
		);
	}

	let searchUrl: URL;
	try {
		// Resolve against the base with a trailing slash, so an instance served
		// under a path (https://host/searxng) keeps it.
		searchUrl = new URL('search', settings.baseUrl.replace(/\/*$/, '/'));
	} catch {
		throw new Error(`Invalid SearXNG base URL: ${settings.baseUrl}`);
	}
	if (searchUrl.protocol !== 'http:' && searchUrl.protocol !== 'https:') {
		throw new Error(
			`Invalid SearXNG base URL protocol "${searchUrl.protocol}". Only http: and https: are supported.`,
		);
	}
	searchUrl.searchParams.set('q', query);
	searchUrl.searchParams.set('format', 'json');

	if (!settings.allowPrivateNetwork) {
		try {
			await assertResolvedPublicHttpUrl(searchUrl.toString());
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			throw new Error(
				`${message}. To use a SearXNG instance on this machine or your network, set nanocoderTools.webSearch.allowPrivateNetwork to true`,
			);
		}
	}

	const response = await fetch(searchUrl, {
		headers: {Accept: 'application/json'},
		// A redirect could lead somewhere the check above never saw.
		redirect: 'error',
		signal: AbortSignal.timeout(TIMEOUT_WEB_SEARCH_MS),
	});

	if (response.status === 403) {
		throw new Error(
			'SearXNG refused the JSON request (HTTP 403). Enable the json format under search.formats in its settings.yml',
		);
	}

	if (response.status === 429) {
		throw new Error('SearXNG rate limit exceeded');
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${response.statusText}`);
	}

	const data = (await response.json()) as SearxngSearchResponse;
	return (data.results ?? [])
		.filter(result => result.title && result.url)
		.slice(0, maxResults)
		.map(result => ({
			title: result.title as string,
			url: result.url as string,
			description: result.content || undefined,
		}));
}

const ENGINES = {
	brave: searchBrave,
	searxng: searchSearxng,
} satisfies Record<
	WebSearchSettings['engine'],
	(
		query: string,
		maxResults: number,
		settings: WebSearchSettings,
	) => Promise<SearchResult[]>
>;

function formatResults(query: string, results: SearchResult[]): string {
	if (results.length === 0) {
		return `No results found for query: "${query}"`;
	}

	let formattedResults = `# Web Search Results: "${query}"\n\n`;

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
}

/**
 * Run a search with the configured engine (or `settings`, for tests) and
 * return the results as markdown.
 */
export const executeWebSearch = async (
	args: SearchArgs,
	settings?: WebSearchSettings,
): Promise<string> => {
	let resolved = settings;
	if (!resolved) {
		const status = getWebSearchStatus();
		if (!status.available) {
			throw new Error(`Web search is not configured: ${status.reason}`);
		}
		resolved = status.settings;
	}

	const maxResults = args.max_results ?? DEFAULT_WEB_SEARCH_RESULTS;

	try {
		const results = await ENGINES[resolved.engine](
			args.query,
			maxResults,
			resolved,
		);
		return formatResults(args.query, results);
	} catch (error: unknown) {
		if (
			error instanceof Error &&
			(error.name === 'AbortError' || error.name === 'TimeoutError')
		) {
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
	const status = getWebSearchStatus();
	// The tool is only registered when its engine is configured; without a
	// config, name the default engine.
	const engine = status.available
		? describeWebSearchEngine(status.settings)
		: 'Brave Search API';

	// Parse result to count actual results
	let resultCount = 0;
	let estimatedTokens = 0;
	if (result) {
		const matches = result.match(/^## \d+\./gm);
		resultCount = matches ? matches.length : 0;
		estimatedTokens = estimateTokens(result);
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
				<Text color={colors.text}>{engine}</Text>
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
			error: 'Search query cannot be empty',
		});
	}

	// Check query length (reasonable limit)
	if (query.length > MAX_WEB_SEARCH_QUERY_LENGTH) {
		return Promise.resolve({
			valid: false,
			error: `Search query is too long (${query.length} characters). Maximum length is ${MAX_WEB_SEARCH_QUERY_LENGTH} characters.`,
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
