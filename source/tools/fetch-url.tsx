// `@nanocollective/get-md` (and its transitive chain: cheerio, turndown,
// readability, domutils, entities) is loaded lazily inside the handler —
// only users who actually invoke `fetch_url` pay the cost.
import {Box, Text} from 'ink';
import React from 'react';
import {DEFAULT_TERMINAL_COLUMNS, MAX_URL_CONTENT_BYTES} from '@/constants';
import {useTheme} from '@/hooks/useTheme';
import {assertResolvedPublicHttpUrl} from '@/tools/fetch-url-guard';
import type {NanocoderToolExport} from '@/types/core';
import {jsonSchema, tool} from '@/types/core';
import {formatError} from '@/utils/error-formatter';
import {withPreservedProcess} from '@/utils/preserve-process';
import {calculateTokens} from '@/utils/token-calculator';

interface FetchArgs {
	url: string;
	start_index?: number;
	max_length?: number;
}

const MAX_REDIRECTS = 5;
const URL_FETCH_TIMEOUT_MS = 15_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/** Statuses that mean "this server will not answer a HEAD", so retry as GET. */
const HEAD_UNSUPPORTED_STATUS_CODES = new Set([400, 403, 405, 501]);

/**
 * Ask one hop what it is, without downloading it.
 *
 * The walk below only needs a status and a `Location`, so it asks for headers
 * rather than a body. A GET here would transfer the whole final page and
 * throw it away, since `convertToMarkdown` fetches the resolved URL itself -
 * every `fetch_url` call would move the target twice, doubling bandwidth and
 * rate-limit consumption and hitting any endpoint that meters or logs
 * requests once per call more than it should.
 *
 * Not every server answers HEAD. One that refuses, or that fails outright,
 * falls back to a GET whose body is discarded - the old behaviour, now only
 * on the servers that actually need it.
 */
const probeHop = async (url: string): Promise<Response> => {
	try {
		const head = await fetch(url, {
			method: 'HEAD',
			redirect: 'manual',
			signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
		});
		if (!HEAD_UNSUPPORTED_STATUS_CODES.has(head.status)) {
			return head;
		}
		await head.body?.cancel();
	} catch {
		// Network-level refusal of the HEAD itself; let the GET report the
		// real error so the message the model sees is unchanged.
	}

	return await fetch(url, {
		redirect: 'manual',
		signal: AbortSignal.timeout(URL_FETCH_TIMEOUT_MS),
	});
};

const resolveSafeRedirects = async (url: string): Promise<string> => {
	let currentUrl = url;

	for (let redirectCount = 0; ; redirectCount++) {
		const validation = await fetchUrlValidator({url: currentUrl});
		if (!validation.valid) {
			throw new Error(validation.error);
		}

		const response = await probeHop(currentUrl);

		try {
			if (!REDIRECT_STATUS_CODES.has(response.status)) {
				return currentUrl;
			}

			const location = response.headers.get('location');
			if (!location) {
				throw new Error(
					`Redirect response from ${currentUrl} did not include a Location header`,
				);
			}

			if (redirectCount >= MAX_REDIRECTS) {
				throw new Error(`Too many redirects while fetching ${url}`);
			}

			currentUrl = new URL(location, currentUrl).toString();
		} finally {
			await response.body?.cancel();
		}
	}
};

/**
 * Converted pages kept briefly so paging through one does not download and
 * convert it again for every chunk. Short and small on purpose: a stale page
 * is worse than a refetch.
 *
 * The markdown is the only thing kept. Every call still walks the redirect
 * chain and validates each hop, so the cache can never be the reason an
 * address gets through that a fresh call would have refused.
 */
const URL_CACHE_TTL_MS = 90_000;
const URL_CACHE_MAX_ENTRIES = 5;
const urlMarkdownCache = new Map<
	string,
	{markdown: string; expiresAt: number}
>();

const getCachedMarkdown = (url: string): string | undefined => {
	const entry = urlMarkdownCache.get(url);
	if (!entry) return undefined;
	if (entry.expiresAt <= Date.now()) {
		urlMarkdownCache.delete(url);
		return undefined;
	}
	return entry.markdown;
};

const cacheMarkdown = (url: string, markdown: string): void => {
	// Re-inserting makes a refreshed page the newest entry: a Map iterates in
	// insertion order, so the first key is the one to evict.
	urlMarkdownCache.delete(url);
	urlMarkdownCache.set(url, {
		markdown,
		expiresAt: Date.now() + URL_CACHE_TTL_MS,
	});
	while (urlMarkdownCache.size > URL_CACHE_MAX_ENTRIES) {
		const oldest = urlMarkdownCache.keys().next().value;
		if (oldest === undefined) break;
		urlMarkdownCache.delete(oldest);
	}
};

/**
 * A model's number, forced into `[min, max]`. Anything that is not a finite
 * number falls back rather than failing the call: these arguments only choose
 * a window, and a usable window beats an error the model cannot act on.
 */
const clampInteger = (
	value: unknown,
	min: number,
	max: number,
	fallback: number,
): number => {
	const number =
		typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
	if (typeof number !== 'number' || !Number.isFinite(number)) return fallback;
	return Math.min(Math.max(Math.floor(number), min), max);
};

const isHighSurrogate = (code: number): boolean =>
	code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean =>
	code >= 0xdc00 && code <= 0xdfff;

/**
 * The part of `content` the caller asked for, with a note saying how to get
 * the next part when there is one.
 *
 * Offsets count UTF-16 units, but neither edge may land inside a surrogate
 * pair: a lone half renders as a replacement character, so the model would be
 * handed text that is not in the page. The next `start_index` is the exact end
 * of this window, so consecutive windows neither overlap nor leave a gap.
 */
const windowContent = (content: string, args: FetchArgs): string => {
	const total = content.length;
	// Zero means the same as leaving it out, not "one character at a time".
	const requestedLength = clampInteger(
		args.max_length,
		0,
		MAX_URL_CONTENT_BYTES,
		MAX_URL_CONTENT_BYTES,
	);
	const maxLength =
		requestedLength > 0 ? requestedLength : MAX_URL_CONTENT_BYTES;
	let start = clampInteger(args.start_index, 0, Number.MAX_SAFE_INTEGER, 0);

	if (start >= total) {
		return `[start_index ${start} is past the end of the content, which is ${total} characters long. Use a smaller start_index.]`;
	}

	if (start > 0 && isLowSurrogate(content.charCodeAt(start))) {
		start -= 1;
	}

	let end = Math.min(start + maxLength, total);
	if (end < total && isHighSurrogate(content.charCodeAt(end - 1))) {
		end -= 1;
	}
	if (end <= start) {
		// A window of one unit over a pair: return the whole pair.
		end = Math.min(start + 2, total);
	}

	const text = content.slice(start, end);
	if (end >= total) return text;

	return `${text}\n\n[Content truncated - showing characters ${start}-${end} of ${total}. Call fetch_url again with start_index=${end} to continue.]`;
};

const executeFetchUrl = async (args: FetchArgs): Promise<string> => {
	try {
		// Walked and validated on every call, cache hit or not: a name that has
		// since started resolving somewhere internal, or a redirect that now
		// points there, must be refused on the tenth call as on the first.
		const safeUrl = await resolveSafeRedirects(args.url);

		// Keyed by where the redirects landed, so a chain that now ends
		// elsewhere converts that page instead of the one it used to reach.
		const cached = getCachedMarkdown(safeUrl);
		if (cached !== undefined) {
			return windowContent(cached, args);
		}

		// Use get-md to convert URL to LLM-friendly markdown (lazy import
		// so the ~100-module HTML-parsing graph only loads when the tool
		// actually runs).
		const {convertToMarkdown} = await import('@nanocollective/get-md');
		// The redirect chain was validated hop by hop above. Keep redirects off
		// for the conversion fetch as well, so a changed response cannot escape
		// validation between the probe and conversion requests. The conversion
		// runs guarded to protect `globalThis.process` from happy-dom overwrites.
		const result = await withPreservedProcess(() =>
			convertToMarkdown(safeUrl, {followRedirects: false}),
		);

		const content = result.markdown;

		if (!content || content.length === 0) {
			throw new Error('No content returned from URL');
		}

		cacheMarkdown(safeUrl, content);

		return windowContent(content, args);
	} catch (error: unknown) {
		const message = formatError(error);
		throw new Error(
			message.startsWith('Failed to fetch URL:')
				? message
				: `Failed to fetch URL: ${message}`,
		);
	}
};

const fetchUrlCoreTool = tool({
	description:
		'Fetch a URL and return its content as cleaned markdown. HTML is converted to readable text. Use for reading documentation pages, blog posts, or any web content. Long pages are returned in parts: when the result ends with a "[Content truncated ...]" note, call fetch_url again with the start_index it gives to read the next part.',
	inputSchema: jsonSchema<FetchArgs>({
		type: 'object',
		properties: {
			url: {
				type: 'string',
				description: 'The URL to fetch content from.',
			},
			start_index: {
				type: 'number',
				description:
					'Optional: Character offset into the converted markdown to start from (default 0). Use the start_index from a previous truncation note to continue reading a long page.',
			},
			max_length: {
				type: 'number',
				description:
					'Optional: Maximum number of characters to return (default and maximum 100000).',
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
	let shown: {start: number; end: number; total: number} | undefined;

	if (result) {
		estimatedTokens = calculateTokens(result);
		const note = result.match(
			/\[Content truncated - showing characters (\d+)-(\d+) of (\d+)\./,
		);
		if (note) {
			shown = {
				start: Number(note[1]),
				end: Number(note[2]),
				total: Number(note[3]),
			};
		}
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
					{shown && (
						<Box>
							<Text color={colors.warning}>
								⚠ Showing characters {shown.start.toLocaleString()}-
								{shown.end.toLocaleString()} of {shown.total.toLocaleString()}
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

const fetchUrlValidator = async (
	args: FetchArgs,
): Promise<{valid: true} | {valid: false; error: string}> => {
	try {
		await assertResolvedPublicHttpUrl(args.url);
		return {valid: true};
	} catch (error: unknown) {
		return {valid: false, error: formatError(error)};
	}
};

export const fetchUrlTool: NanocoderToolExport = {
	name: 'fetch_url' as const,
	tool: fetchUrlCoreTool,
	formatter: fetchUrlFormatter,
	validator: fetchUrlValidator,
	readOnly: true,
};
