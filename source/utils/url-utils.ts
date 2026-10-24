const LOCAL_HOSTNAMES = new Set([
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
	'[::1]',
	'::1',
]);

/**
 * Check if a URL points to a local server.
 * Matches: localhost, 127.0.0.1, 0.0.0.0, ::1
 */
export function isLocalURL(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.hostname) {
			return LOCAL_HOSTNAMES.has(parsed.hostname);
		}
	} catch {
		// Fall through to string matching
	}
	// Fallback for malformed URLs or empty hostname: check the raw string
	return (
		url.includes('localhost') ||
		url.includes('127.0.0.1') ||
		url.includes('0.0.0.0') ||
		url.includes('::1')
	);
}

/**
 * Redacts secrets, embedded credentials, query strings, and long sensitive
 * token path segments from a URL for safe public diagnostics and logs (e.g. /doctor).
 *
 * Examples:
 * - https://user:sk-test-LEAKCHECK123@proxy.example.com/v1?key=QUERYKEY-LEAKCHECK
 *   -> https://proxy.example.com/v1
 * - https://mcp.example.com/api/mcp/s/PATHTOKEN-LEAKCHECK/mcp?api_key=APIKEY-LEAKCHECK
 *   -> https://mcp.example.com/api/mcp/s/<redacted>/mcp
 */
export function redactUrlSecrets(
	url: string | null | undefined,
): string | undefined {
	if (!url || typeof url !== 'string') {
		return undefined;
	}

	const trimmed = url.trim();
	if (!trimmed) {
		return undefined;
	}

	try {
		const parsed = new URL(trimmed);
		// Strip username and password
		parsed.username = '';
		parsed.password = '';
		// Strip query parameters and hash fragments
		parsed.search = '';
		parsed.hash = '';

		// Mask sensitive, token-like or long path segments
		const segments = parsed.pathname.split('/');
		const sanitizedSegments = segments.map(segment => {
			if (!segment) {
				return segment;
			}
			// Mask long path segments (typically session tokens, API keys, UUIDs, or hashes)
			// or segments with token-like prefixes
			if (
				segment.length >= 16 ||
				/^(sk-|ghp_|token|key-|pat-)/i.test(segment)
			) {
				return '<redacted>';
			}
			return segment;
		});

		parsed.pathname = sanitizedSegments.join('/');

		let result = parsed.toString();
		if (result.endsWith('/') && !trimmed.endsWith('/')) {
			result = result.slice(0, -1);
		}
		return result.replaceAll('%3Credacted%3E', '<redacted>');
	} catch {
		// Fallback for non-standard or malformed URLs
		let fallback = trimmed.replace(/\?.*$/, '').replace(/#.*$/, '');
		fallback = fallback.replace(/\/\/[^/@]+@/, '//');
		return fallback;
	}
}
