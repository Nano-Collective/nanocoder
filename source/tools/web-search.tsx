import {fetch} from 'undici';
import * as cheerio from 'cheerio';
import React from 'react';
import {Text, Box} from 'ink';

import {tool, jsonSchema} from '@/types/core';
import type {NanocoderToolExport} from '@/types/core';
import {ThemeContext} from '@/hooks/useTheme';
import ToolMessage from '@/components/tool-message';

interface SearchArgs {
	query: string;
	max_results?: number;
}

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

const executeWebSearch = async (args: SearchArgs): Promise<string> => {
	const maxResults = args.max_results ?? 10;
	const encodedQuery = encodeURIComponent(args.query);

	try {
		// Use Brave Search - scraper-friendly, no CAPTCHA
		const searchUrl = `https://search.brave.com/search?q=${encodedQuery}`;

		const response = await fetch(searchUrl, {
			headers: {
				'User-Agent':
					'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
				Accept: 'text/html',
			},
			signal: AbortSignal.timeout(10000),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const html = await response.text();
		const $ = cheerio.load(html);

		const results: SearchResult[] = [];

		// Brave Search uses specific result containers
		$('[data-type="web"]').each((_i, elem) => {
			if (results.length >= maxResults) return;

			const $elem = $(elem);

			// Extract title and URL
			const titleLink = $elem.find('a[href^="http"]').first();
			const url = titleLink.attr('href');
			const title = titleLink.text().trim();

			// Extract snippet
			const snippet = $elem.find('.snippet-description').text().trim();

			if (url && title) {
				results.push({
					title: title || 'No title',
					url,
					snippet: snippet || '',
				});
			}
		});

		if (results.length === 0) {
			return `No results found for query: "${args.query}"`;
		}

		// Format results as markdown for easier LLM reading
		let formattedResults = `# Web Search Results: "${args.query}"\n\n`;

		for (let i = 0; i < results.length; i++) {
			const result = results[i];
			formattedResults += `## ${i + 1}. ${result.title}\n\n`;
			formattedResults += `**URL:** ${result.url}\n\n`;
			if (result.snippet) {
				formattedResults += `${result.snippet}\n\n`;
			}
			formattedResults += '---\n\n';
		}

		return formattedResults;
	} catch (error: unknown) {
		if (error instanceof Error && error.name === 'AbortError') {
			throw new Error('Search request timeout');
		}

		const errorMessage =
			error instanceof Error ? error.message : 'Unknown error';
		throw new Error(`Web search failed: ${errorMessage}`);
	}
};

const webSearchCoreTool = tool({
	description:
		'Search the web for information (scrapes Brave Search, returns markdown)',
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

// Create a component that will re-render when theme changes
const WebSearchFormatter = React.memo(
	({args, result}: {args: SearchArgs; result?: string}) => {
		const themeContext = React.useContext(ThemeContext);
		if (!themeContext) {
			throw new Error('ThemeContext not found');
		}
		const {colors} = themeContext;
		const query = args.query || 'unknown';
		const maxResults = args.max_results ?? 5;

		// Parse result to count actual results
		let resultCount = 0;
		let estimatedTokens = 0;
		if (result) {
			const matches = result.match(/^## \d+\./gm);
			resultCount = matches ? matches.length : 0;
			estimatedTokens = Math.ceil(result.length / 4);
		}

		const messageContent = (
			<Box flexDirection="column">
				<Text color={colors.tool}>⚒ web_search</Text>

				<Box>
					<Text color={colors.secondary}>Query: </Text>
					<Text color={colors.white}>{query}</Text>
				</Box>

				<Box>
					<Text color={colors.secondary}>Engine: </Text>
					<Text color={colors.white}>Brave Search</Text>
				</Box>

				{result && (
					<>
						<Box>
							<Text color={colors.secondary}>Results: </Text>
							<Text color={colors.white}>
								{resultCount} / {maxResults} results
							</Text>
						</Box>

						<Box>
							<Text color={colors.secondary}>Output: </Text>
							<Text color={colors.white}>~{estimatedTokens} tokens</Text>
						</Box>
					</>
				)}
			</Box>
		);

		return <ToolMessage message={messageContent} hideBox={true} />;
	},
);

const webSearchFormatter = (
	args: SearchArgs,
	result?: string,
): React.ReactElement => {
	return <WebSearchFormatter args={args} result={result} />;
};

const webSearchValidator = (
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
	if (query.length > 500) {
		return Promise.resolve({
			valid: false,
			error: `⚒ Search query is too long (${query.length} characters). Maximum length is 500 characters.`,
		});
	}

	return Promise.resolve({valid: true});
};

export const webSearchTool: NanocoderToolExport = {
	name: 'web_search' as const,
	tool: webSearchCoreTool,
	formatter: webSearchFormatter,
	validator: webSearchValidator,
};
