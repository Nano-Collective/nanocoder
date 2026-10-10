const LOCAL_HOSTNAMES = new Set([
	'localhost',
	'127.0.0.1',
	'0.0.0.0',
	'[::1]',
	'::1',
]);

const REDACTED = 'REDACTED';

// Query keys whose value is a credential regardless of shape. Matched
// case-insensitively against the key name.
const SECRET_QUERY_KEYS = new Set([
	'api_key',
	'apikey',
	'api-key',
	'key',
	'token',
	'access_token',
	'auth',
	'authorization',
	'secret',
	'password',
	'passwd',
	'pwd',
	'session',
	'signature',
	'sig',
	'credential',
]);

// Path segments that are pure credentials rather than resource identifiers.
// A segment counts as a token when it is long and high-entropy, or when the
// segment before it is a literal credential marker (`token`, `t`, `s`, ...).
const TOKEN_MARKER_SEGMENTS = new Set([
	'token',
	't',
	's',
	'key',
	'k',
	'auth',
	'secret',
]);
const MIN_TOKEN_LENGTH = 16;

/**
 * Strip credentials embedded in a URL so it is safe to print or paste into a
 * bug report.
 *
 * Covers the shapes providers and MCP servers actually use:
 * - userinfo: `https://user:password@host/` → `https://REDACTED:REDACTED@host/`
 * - query credentials: `?api_key=…`, `?token=…` → `?api_key=REDACTED`
 * - path tokens: `/api/mcp/s/<token>/mcp` → `/api/mcp/s/REDACTED/mcp`
 *
 * The scheme, host, port and non-secret path/query structure are preserved so
 * the URL stays diagnosable. Malformed URLs fall back to a conservative
 * string redaction of userinfo, since `new URL` cannot parse them.
 */
export function redactSecretsInURL(url: string): string {
	if (!url) {
		return url;
	}

	let parsed: URL;
	let redactedAuthority = '';
	try {
		parsed = new URL(url);
	} catch {
		// Malformed URL: still strip an obvious `user:pass@` so a typo'd URL
		// cannot leak either.
		return url.replace(/\/\/[^/@]*@/, '//REDACTED@');
	}

	if (parsed.username || parsed.password) {
		// The URL API always serializes an authority as `user[:password]@`, so a
		// password-less `https://token@host` would render as `REDACTED:REDACTED@`
		// — a password that never existed. Redact the userinfo as one unit and
		// splice it back into the final string instead.
		redactedAuthority = `${REDACTED}${parsed.password ? ':' + REDACTED : ''}@`;
		parsed.username = '';
		parsed.password = '';
	}

	const pathSegments = parsed.pathname.split('/').map((segment, index, all) => {
		if (!segment) {
			return segment;
		}
		const previous = all[index - 1]?.toLowerCase() ?? '';
		// Single-character markers (`s`, `t`, `k`) only count when the path
		// continues past the token — `/s/<token>/mcp` is an MCP mount, while
		// `/s/settings` and `/t/translation` name real resources whose last
		// segment would otherwise be redacted.
		const markerCounts =
			TOKEN_MARKER_SEGMENTS.has(previous) &&
			(previous.length > 1 || all.slice(index + 1).some(Boolean));
		if (
			markerCounts ||
			(segment.length >= MIN_TOKEN_LENGTH && isHighEntropy(segment))
		) {
			return REDACTED;
		}
		return segment;
	});
	parsed.pathname = pathSegments.join('/');

	if (parsed.search) {
		const params = parsed.searchParams;
		for (const key of [...params.keys()]) {
			if (SECRET_QUERY_KEYS.has(normalizeSecretKey(key))) {
				params.set(key, REDACTED);
			}
		}
		parsed.search = params.toString();
	}

	const serialized = parsed.toString();
	if (!redactedAuthority) {
		return serialized;
	}
	// Re-attach the redacted userinfo: clearing username/password on the URL
	// object drops the `@` entirely, and re-setting them forces the
	// `user:password` shape the original may not have had.
	return serialized.replace(/\/\//, `//${redactedAuthority}`);
}

function normalizeSecretKey(key: string): string {
	// Fold camelCase and kebab-case onto the snake_case keys the set uses, so
	// `AccessToken`, `access-token` and `access_token` all match.
	return key
		.replace(/([a-z0-9])([A-Z])/g, '$1_$2')
		.replaceAll('-', '_')
		.toLowerCase();
}

function isHighEntropy(value: string): boolean {
	// A credential-shaped segment mixes character classes; ordinary words and
	// version numbers do not. At least two of: lower, upper, digit, symbol.
	const classes = [
		/[a-z]/.test(value),
		/[A-Z]/.test(value),
		/[0-9]/.test(value),
		/[^a-zA-Z0-9]/.test(value),
	].filter(Boolean).length;
	return classes >= 2;
}

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
