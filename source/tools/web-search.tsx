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

/**
 * Collapses internal newlines into single spaces so a value can never
 * land at the start of a markdown line (heading/list/blockquote position).
 */
function collapseNewlines(text: string): string {
	return text.replace(/\r?\n+/g, ' ').trim();
}

/**
 * Strips Brave's query-term highlight tags. These arrive as literal
 * <strong>/</strong> markup in titles and descriptions; left alone they'd
 * get escaped into ugly `\<strong\>` noise, so remove them before escaping.
 */
function stripHighlightTags(text: string): string {
	return text.replace(/<\/?strong>/gi, '');
}

/**
 * Escapes markdown syntax characters to prevent formatting disruption and
 * injection (e.g. fake headings, spoofed links, setext-style `===` headings).
 *
 * Deliberately a minimal inline set rather than the full CommonMark
 * punctuation list: `# - + . >` etc. only have special meaning at the start
 * of a line, and callers already collapse newlines and prefix content with
 * `## N. `, so those characters can never land in heading/list position.
 * Escaping them anyway just burns tokens in the model's context for no
 * safety benefit.
 */
export function escapeMarkdown(text: string): string {
	return text.replace(/([\\`*_[\]<>~|=])/g, '\\$1');
}

/**
 * Normalizes and sanitizes a URL for safe embedding in a Markdown autolink.
 * Strips whitespace and angle brackets that would break the `<...>` wrapper,
 * and restricts to http(s) schemes so `javascript:`/`data:` etc. can't ride
 * along disguised as a search result link.
 */
export function sanitizeUrl(url: string): string {
	const cleaned = url.replace(/\s+/g, '').replace(/[<>]/g, '');

	try {
		const parsed = new URL(cleaned);
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return '';
		}
	} catch {
		return '';
	}

	return cleaned;
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

		const safeQuery = escapeMarkdown(collapseNewlines(args.query));

		if (results.length === 0) {
			return `No results found for query: "${safeQuery}"`;
		}

		let formattedResults = `# Web Search Results: "${safeQuery}"\n\n`;

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			if (!result) continue;

			const normalizedTitle = collapseNewlines(
				stripHighlightTags(result.title || ''),
			);
			const safeTitle = escapeMarkdown(normalizedTitle);
			const safeUrl = sanitizeUrl(result.url || '');

			formattedResults += `## ${i + 1}. ${safeTitle}\n\n`;

			if (safeUrl) {
				formattedResults += `**URL:** <${safeUrl}>\n\n`;
			}

			if (result.description) {
				const normalizedDescription = collapseNewlines(
					stripHighlightTags(result.description),
				);
				const safeDescription = escapeMarkdown(normalizedDescription);
				formattedResults += `${safeDescription}\n\n`;
			}

			formattedResults += '---\n\n';
		}

		return formattedResults;
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

		throw new Error('Web search failed: Unknown error');
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

	if (!query) {
		return Promise.resolve({
			valid: false,
			error: 'Search query cannot be empty',
		});
	}

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
