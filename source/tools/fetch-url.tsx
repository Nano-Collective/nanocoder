// `@nanocollective/get-md` (and its transitive chain: cheerio, turndown,
// readability, domutils, entities) is loaded lazily inside the handler —
// only users who actually invoke `fetch_url` pay the cost.

import * as net from 'node:net';
import {Box, Text} from 'ink';
import React from 'react';
import {DEFAULT_TERMINAL_COLUMNS, MAX_URL_CONTENT_BYTES} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {calculateTokens} from '@/utils/token-calculator';

interface FetchArgs {
	url: string;
}

function validateUrlInternal(urlStr: string): string | undefined {
	let parsedUrl: URL;
	try {
		parsedUrl = new URL(urlStr);
	} catch {
		return `Invalid URL format: ${urlStr}`;
	}

	if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
		return `Invalid URL protocol "${parsedUrl.protocol}". Only http: and https: are supported.`;
	}

	let hostname = parsedUrl.hostname.toLowerCase();
	if (hostname.endsWith('.')) {
		hostname = hostname.slice(0, -1);
	}

	if (hostname === 'localhost' || hostname === 'metadata.google.internal') {
		return `Cannot fetch from internal/private network address: ${hostname}`;
	}

	if (net.isIPv4(hostname)) {
		const parts = hostname.split('.').map(Number);
		const p1 = parts[1] ?? 0;
		if (
			parts[0] === 127 ||
			parts[0] === 10 ||
			parts[0] === 0 ||
			(parts[0] === 172 && p1 >= 16 && p1 <= 31) ||
			(parts[0] === 192 && p1 === 168) ||
			(parts[0] === 169 && p1 === 254) ||
			(parts[0] === 100 && p1 >= 64 && p1 <= 127)
		) {
			return `Cannot fetch from internal/private network address: ${hostname}`;
		}
	}

	if (hostname.startsWith('[') && hostname.endsWith(']')) {
		const ip6 = hostname.slice(1, -1);
		if (net.isIPv6(ip6)) {
			if (ip6 === '::1' || ip6 === '::') {
				return `Cannot fetch from internal/private network address: ${hostname}`;
			}
			if (/^f[cd][0-9a-f]{2}:/i.test(ip6)) {
				return `Cannot fetch from internal/private network address: ${hostname}`;
			}
			if (/^fe[89ab][0-9a-f]:/i.test(ip6)) {
				return `Cannot fetch from internal/private network address: ${hostname}`;
			}

			if (ip6.startsWith('::ffff:')) {
				const match = ip6.match(/^::ffff:([0-9a-f]+):([0-9a-f]+)$/i);
				if (match && match[1] && match[2]) {
					const high = Number.parseInt(match[1], 16);
					const low = Number.parseInt(match[2], 16);
					const parts = [high >> 8, high & 0xff, low >> 8, low & 0xff];
					const p1 = parts[1] ?? 0;

					if (
						parts[0] === 127 ||
						parts[0] === 10 ||
						parts[0] === 0 ||
						(parts[0] === 172 && p1 >= 16 && p1 <= 31) ||
						(parts[0] === 192 && p1 === 168) ||
						(parts[0] === 169 && p1 === 254) ||
						(parts[0] === 100 && p1 >= 64 && p1 <= 127)
					) {
						return `Cannot fetch from internal/private network address: ${hostname}`;
					}
				}
			}
		}
	}

	return undefined;
}

const executeFetchUrl = async (args: FetchArgs): Promise<string> => {
	// Validate URL
	const validationError = validateUrlInternal(args.url);
	if (validationError) {
		throw new Error(validationError);
	}

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
								⚠ Content was truncated to 100KB
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
	const error = validateUrlInternal(args.url);
	if (error) {
		return Promise.resolve({valid: false, error});
	}
	return Promise.resolve({valid: true});
};

export const fetchUrlTool: NanocoderToolExport = {
	name: 'fetch_url' as const,
	tool: fetchUrlCoreTool,
	formatter: fetchUrlFormatter,
	validator: fetchUrlValidator,
	readOnly: true,
};
