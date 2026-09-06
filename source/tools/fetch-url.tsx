// `@nanocollective/get-md` (and its transitive chain: cheerio, turndown,
// readability, domutils, entities) is loaded lazily inside the handler —
// only users who actually invoke `fetch_url` pay the cost.
import {Box, Text} from 'ink';
import React from 'react';
import {DEFAULT_TERMINAL_COLUMNS, MAX_URL_CONTENT_BYTES} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import {assertPublicHttpUrl} from '@/tools/fetch-url-guard';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {calculateTokens} from '@/utils/token-calculator';

interface FetchArgs {
	url: string;
}

const executeFetchUrl = async (args: FetchArgs): Promise<string> => {
	assertPublicHttpUrl(args.url);

	try {
		// Use get-md to convert URL to LLM-friendly markdown (lazy import
		// so the ~100-module HTML-parsing graph only loads when the tool
		// actually runs).
		const {convertToMarkdown} = await import('@nanocollective/get-md');
		const result = await convertToMarkdown(args.url);

		const content = result.markdown;

		if (!content || content.length === 0) {
			throw new Error('No content returned from URL');
		}

		// Limit content size to prevent context overflow
		if (content.length > MAX_URL_CONTENT_BYTES) {
			const truncated = content.substring(0, MAX_URL_CONTENT_BYTES);
			return `${truncated}\n\n[Content truncated - original size was ${content.length} characters]`;
		}

		return content;
	} catch (error: unknown) {
		const message = formatError(error);
		throw new Error(`Failed to fetch URL: ${message}`);
	}
};

const fetchUrlCoreTool = tool({
	description:
		'Fetch a URL and return its content as cleaned markdown. HTML is converted to readable text. Use for reading documentation pages, blog posts, or any web content.',
	inputSchema: jsonSchema<FetchArgs>({
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'The URL to fetch content from.',
			},
		},
		required: ['url'],
	}),
	execute: async (args, _options) => {
		return await executeFetchUrl(args);
	},
});

function FetchUrlFormatterComponent({
	url,
	result,
}: {
	url: string;
	result?: string;
}): React.ReactElement {
	const {colors} = useTheme();

	// Calculate content stats from result
	let estimatedTokens = 0;
	let wasTruncated = false;

	if (result) {
		estimatedTokens = calculateTokens(result);
		wasTruncated = result.includes('[Content truncated');
	}

	const terminalWidth = process.stdout.columns || DEFAULT_TERMINAL_COLUMNS;
	const urlLabelWidth = 6; // "URL: " + 1 margin
	const availableWidth = Math.max(terminalWidth - urlLabelWidth, 20);

	const truncatedUrl =
		url.length <= availableWidth
			? url
			: url.slice(0, Math.floor(availableWidth / 2) - 1) +
				'…' +
				url.slice(-(Math.ceil(availableWidth / 2) - 1));

	return (
		<Box flexDirection="column" marginBottom={1}>
			<Text color={colors.tool}>⚒ fetch_url</Text>
			<Box>
				<Text color={colors.secondary}>URL: </Text>
				<Box marginLeft={1}>
					<Text color={colors.text}>{truncatedUrl}</Text>
				</Box>
			</Box>
			{result && (
				<>
					<Box>
						<Text color={colors.secondary}>Tokens: </Text>
						<Text color={colors.text}>~{estimatedTokens} tokens</Text>
					</Box>
					{wasTruncated && (
						<Box>
							<Text color={colors.warning}>
								⚠ Content was truncated to{' '}
								{MAX_URL_CONTENT_BYTES.toLocaleString()} characters
							</Text>
						</Box>
					)}
				</>
			)}
		</Box>
	);
}

const fetchUrlFormatter = (
	args: FetchArgs,
	result?: string,
): React.ReactElement => {
	return (
		<FetchUrlFormatterComponent url={args.url || 'unknown'} result={result} />
	);
};

const fetchUrlValidator = (
	args: FetchArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	try {
		assertPublicHttpUrl(args.url);
		return Promise.resolve({valid: true});
	} catch (error: unknown) {
		return Promise.resolve({
			valid: false,
			error: formatError(error),
		});
	}
};

export const fetchUrlTool: NanocoderToolExport = {
	name: 'fetch_url' as const,
	tool: fetchUrlCoreTool,
	formatter: fetchUrlFormatter,
	validator: fetchUrlValidator,
	readOnly: true,
};
