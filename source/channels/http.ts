/**
 * The one HTTP helper the adapters share: a JSON request with a single
 * retry on 429. Every platform rate-limits and every one of them says how
 * long to wait, in a slightly different place; this is where that
 * difference is absorbed so the adapters can treat a send as fire-and-check.
 */

export type FetchLike = typeof fetch;

export interface JsonRequestOptions {
	method?: 'GET' | 'POST';
	headers?: Record<string, string>;
	/** Serialized as JSON when present. */
	body?: unknown;
	signal?: AbortSignal;
	fetchImpl?: FetchLike;
	sleep?: (ms: number) => Promise<void>;
}

export interface JsonResponse {
	status: number;
	/** Parsed JSON body, or the raw text when the body is not JSON. */
	body: unknown;
}

/** Longest a 429 may hold a request before we give up on the retry. */
const MAX_RETRY_AFTER_MS = 30_000;

export async function requestJson(
	url: string,
	options: JsonRequestOptions = {},
): Promise<JsonResponse> {
	const fetchImpl = options.fetchImpl ?? fetch;
	const sleep = options.sleep ?? defaultSleep;

	let response = await send(fetchImpl, url, options);
	if (response.status === 429) {
		const wait = retryAfterMs(response);
		if (wait !== null && wait <= MAX_RETRY_AFTER_MS) {
			await sleep(wait);
			response = await send(fetchImpl, url, options);
		}
	}
	return {status: response.status, body: response.body};
}

interface RawResponse {
	status: number;
	headers: Headers;
	body: unknown;
}

async function send(
	fetchImpl: FetchLike,
	url: string,
	options: JsonRequestOptions,
): Promise<RawResponse> {
	const headers: Record<string, string> = {...options.headers};
	let body: string | undefined;
	if (options.body !== undefined) {
		headers['content-type'] = 'application/json';
		body = JSON.stringify(options.body);
	}
	const response = await fetchImpl(url, {
		method: options.method ?? (body === undefined ? 'GET' : 'POST'),
		headers,
		body,
		signal: options.signal,
	});
	const text = await response.text();
	let parsed: unknown = text;
	if (text) {
		try {
			parsed = JSON.parse(text);
		} catch {
			// Not JSON (an HTML error page, say) - keep the text for the error.
		}
	}
	return {status: response.status, headers: response.headers, body: parsed};
}

/**
 * Milliseconds to wait before retrying, from whichever place the platform
 * put it: the `Retry-After` header (seconds; Slack, Discord), Telegram's
 * `parameters.retry_after` (seconds), or Discord's body `retry_after`
 * (seconds, fractional).
 */
function retryAfterMs(response: RawResponse): number | null {
	const header = response.headers.get('retry-after');
	if (header) {
		const seconds = Number(header);
		if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
	}
	const body = response.body;
	if (body && typeof body === 'object') {
		const record = body as Record<string, unknown>;
		const params = record.parameters;
		const nested =
			params && typeof params === 'object'
				? (params as Record<string, unknown>).retry_after
				: undefined;
		const seconds = nested ?? record.retry_after;
		if (
			typeof seconds === 'number' &&
			Number.isFinite(seconds) &&
			seconds >= 0
		) {
			return seconds * 1000;
		}
	}
	return null;
}

function defaultSleep(ms: number): Promise<void> {
	return new Promise(resolve => setTimeout(resolve, ms));
}
