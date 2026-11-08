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

const SAFE_API_SEGMENTS = new Set([
	'api',
	'v1',
	'v2',
	'v3',
	'v4',
	'v1beta',
	'chat',
	'completions',
	'embeddings',
	'models',
	'deployments',
	'messages',
	'threads',
	'runs',
	'audio',
	'transcriptions',
	'speech',
	'images',
	'generations',
	'files',
	'fine_tuning',
	'batches',
	'moderations',
	'tokenizer',
	'tokens',
	'encode',
	'decode',
	'auth',
	'oauth',
	'token',
	'mcp',
	'sse',
	'ws',
	'health',
	'status',
	'info',
	'version',
	'ping',
	'ready',
	'hooks',
	'webhook',
	'webhooks',
	'services',
	'openai',
	'anthropic',
	'azure',
	'google',
]);

const SECRET_CONTAINER_SEGMENTS = new Set([
	'hooks',
	'hook',
	'webhook',
	'webhooks',
	'services',
	's',
	'secret',
	'secrets',
]);

const TOKEN_PREFIX_REGEX =
	/^(sk-[a-zA-Z0-9_-]+|ghp_[a-zA-Z0-9]+|gho_[a-zA-Z0-9]+|pat-[a-zA-Z0-9_-]+|key-[a-zA-Z0-9_-]+|token[-_][a-zA-Z0-9_-]+|sec[-_][a-zA-Z0-9_-]+)$/i;
const UUID_REGEX =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HEX_HASH_REGEX = /^[0-9a-fA-F]{24,}$/;

function isModelOrDeploymentName(segment: string): boolean {
	const lower = segment.toLowerCase();
	if (
		lower.endsWith('-deployment') ||
		lower.endsWith('_deployment') ||
		lower.endsWith('-model') ||
		lower.endsWith('_model')
	) {
		return true;
	}
	return /^(gpt|claude|llama|gemini|mistral|deepseek|qwen|phi|command|whisper|dall-e|text-embedding)/i.test(
		lower,
	);
}

function isOpaqueToken(segment: string, prevSegment: string): boolean {
	if (!segment) {
		return false;
	}
	const lower = segment.toLowerCase();
	if (SAFE_API_SEGMENTS.has(lower)) {
		return false;
	}
	if (TOKEN_PREFIX_REGEX.test(segment)) {
		return true;
	}
	if (UUID_REGEX.test(segment) || HEX_HASH_REGEX.test(segment)) {
		return true;
	}
	if (prevSegment && SECRET_CONTAINER_SEGMENTS.has(prevSegment.toLowerCase())) {
		return true;
	}
	// Mixed-case alphanumeric opaque string (e.g. webhook secret token like abc123XYZ789)
	if (
		/[a-z]/.test(segment) &&
		/[A-Z]/.test(segment) &&
		/\d/.test(segment) &&
		segment.length >= 10 &&
		!segment.includes('-') &&
		!segment.includes('.')
	) {
		return true;
	}
	if (segment.length >= 24 && !isModelOrDeploymentName(segment)) {
		return true;
	}
	return false;
}

/**
 * Masks opaque token path segments, sensitive prefix tokens, or webhook secrets,
 * while preserving valid API endpoints, model IDs, and Azure deployment names.
 */
function maskPathSegments(pathname: string): string {
	const segments = pathname.split('/');
	const sanitizedSegments = segments.map((segment, index) => {
		const prev = index > 0 ? segments[index - 1] : '';
		if (isOpaqueToken(segment, prev)) {
			return '<redacted>';
		}
		return segment;
	});
	return sanitizedSegments.join('/');
}

/**
 * Redacts secrets, embedded credentials, query strings, and long sensitive
 * token path segments from a URL for safe public diagnostics and logs (e.g. /doctor, /mcp).
 *
 * Examples:
 * - https://user:sk-test-LEAKCHECK123@proxy.example.com/v1?key=QUERYKEY-LEAKCHECK
 *   -> https://proxy.example.com/v1
 * - https://mcp.example.com/api/mcp/s/PATHTOKEN-LEAKCHECK/mcp?api_key=APIKEY-LEAKCHECK
 *   -> https://mcp.example.com/api/mcp/s/<redacted>/mcp
 * - user:pass@proxy.example.com/v1/sk-abc123def4567890
 *   -> proxy.example.com/v1/<redacted>
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

	const hasScheme =
		/^[a-zA-Z][a-zA-Z\d+.-]*:\/\//.test(trimmed) || trimmed.startsWith('//');

	if (hasScheme) {
		try {
			const parsed = new URL(trimmed);
			// Strip username and password
			parsed.username = '';
			parsed.password = '';
			// Strip query parameters and hash fragments
			parsed.search = '';
			parsed.hash = '';

			// Mask sensitive, token-like or long path segments
			parsed.pathname = maskPathSegments(parsed.pathname);

			let result = parsed.toString();
			if (result.endsWith('/') && !trimmed.endsWith('/')) {
				result = result.slice(0, -1);
			}
			return result.replaceAll('%3Credacted%3E', '<redacted>');
		} catch {
			// Fall through to schemeless fallback if standard parsing fails
		}
	}

	// Fallback for non-standard, schemeless, or malformed URLs
	let fallback = trimmed.replace(/\?.*$/, '').replace(/#.*$/, '');
	// Strip userinfo (user:pass@) whether or not preceded by //
	fallback = fallback.replace(/^([^/]*\/\/)?[^/@]+@/, '$1');

	// Locate where the path begins to mask sensitive segments
	const doubleSlashIndex = fallback.indexOf('//');
	const searchFrom = doubleSlashIndex !== -1 ? doubleSlashIndex + 2 : 0;
	const pathStartIndex = fallback.indexOf('/', searchFrom);

	if (pathStartIndex !== -1) {
		const hostPart = fallback.slice(0, pathStartIndex);
		const pathPart = fallback.slice(pathStartIndex);
		return hostPart + maskPathSegments(pathPart);
	}

	return fallback;
}
