/**
 * Reject fetch_url targets that are loopback, private, link-local, or cloud
 * metadata — on the *request* URL only.
 *
 * `fetch-url.tsx` resolves redirects itself and runs every hop through this
 * same check, so a `http://attacker.example/r` → `http://169.254.169.254/`
 * chain is rejected at the hop rather than followed (#1089).
 *
 * Known gap (not this file): DNS rebinding. A public name can resolve to a
 * blocked address at request time; this check is hostname-string / parsed IP,
 * not a pinned lookup.
 */

function parseIpv4(host: string): number | null {
	const parts = host.split('.');
	if (parts.length !== 4) return null;
	let n = 0;
	for (const part of parts) {
		if (!/^\d{1,3}$/.test(part)) return null;
		const oct = Number(part);
		if (oct > 255) return null;
		n = ((n << 8) | oct) >>> 0;
	}
	return n;
}

function ipv4InCidr(ip: number, base: number, prefix: number): boolean {
	const mask = (0xffffffff << (32 - prefix)) >>> 0;
	return (ip & mask) === (base & mask);
}

function isNonPublicIpv4(ip: number): boolean {
	return (
		ipv4InCidr(ip, 0x00000000, 8) || // 0.0.0.0/8
		ipv4InCidr(ip, 0x0a000000, 8) || // 10.0.0.0/8
		ipv4InCidr(ip, 0x64400000, 10) || // 100.64.0.0/10 CGNAT
		ipv4InCidr(ip, 0x7f000000, 8) || // 127.0.0.0/8
		ipv4InCidr(ip, 0xa9fe0000, 16) || // 169.254.0.0/16
		ipv4InCidr(ip, 0xac100000, 12) || // 172.16.0.0/12
		ipv4InCidr(ip, 0xc0a80000, 16) || // 192.168.0.0/16
		ipv4InCidr(ip, 0xc0000000, 24) || // 192.0.0.0/24
		ipv4InCidr(ip, 0xc0000200, 24) || // 192.0.2.0/24 TEST-NET-1
		ipv4InCidr(ip, 0xc6120000, 16) || // 198.18.0.0/15 benchmarking
		ipv4InCidr(ip, 0xc6336400, 24) || // 198.51.100.0/24 TEST-NET-2
		ipv4InCidr(ip, 0xcb007100, 24) || // 203.0.113.0/24 TEST-NET-3
		ipv4InCidr(ip, 0xe0000000, 4) || // 224.0.0.0/4 multicast
		ipv4InCidr(ip, 0xf0000000, 4) // 240.0.0.0/4 reserved (incl. 255.255.255.255 limited broadcast)
	);
}

function ipv4FromMappedIpv6(host: string): number | null {
	const dotted = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(host);
	if (dotted?.[1]) return parseIpv4(dotted[1]);
	const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(host);
	if (!hex?.[1] || !hex[2]) return null;
	const hi = Number.parseInt(hex[1], 16);
	const lo = Number.parseInt(hex[2], 16);
	return ((hi << 16) | lo) >>> 0;
}

/**
 * Parse `host` into eight 16-bit groups, expanding `::` compression and
 * an embedded dotted-quad IPv4 tail. Returns null when `host` is not a
 * valid IPv6 literal.
 */
export function normalizeIpv6(host: string): number[] | null {
	const dotted = /(\d+\.\d+\.\d+\.\d+)$/.exec(host);
	let expanded = host;
	if (dotted?.[1]) {
		const v4 = parseIpv4(dotted[1]);
		if (v4 === null) return null;
		const hi = ((v4 >>> 16) & 0xffff).toString(16);
		const lo = (v4 & 0xffff).toString(16);
		expanded = host.slice(0, dotted.index) + `${hi}:${lo}`;
	}
	const halves = expanded.toLowerCase().split('::');
	if (halves.length > 2) return null;
	const parseGroups = (text: string): number[] | null => {
		if (text === '') return [];
		const parts = text.split(':');
		if (parts.length > 8) return null;
		const groups: number[] = [];
		for (const part of parts) {
			if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
			groups.push(Number.parseInt(part, 16));
		}
		return groups;
	};
	const left = parseGroups(halves[0] ?? '');
	if (left === null) return null;
	if (halves.length === 1) {
		return left.length === 8 ? left : null;
	}
	const right = parseGroups(halves[1] ?? '');
	if (right === null) return null;
	const missing = 8 - left.length - right.length;
	if (missing < 1) return null;
	return [...left, ...new Array(missing).fill(0), ...right];
}

/**
 * Extract the embedded IPv4 address from the IPv6 spellings that can carry
 * one (RFC 4291): IPv4-compatible `::/96` (`::127.0.0.1`), well-known
 * NAT64 prefix `64:ff9b::/96` (RFC 6052 §2.1), 6to4 `2002::/16`, and the
 * `::ffff:0:0/96` (IPv4-translated) family. The standard
 * IPv4-mapped `::ffff:a.b.c.d` is handled by `ipv4FromMappedIpv6`.
 *
 * Only the /96 well-known prefix is covered here; local-use prefixes
 * (/32../64) are not.
 *
 * Returns null when the address does not match any of the embedded-IPv4 prefixes.
 */
function ipv4FromEmbeddedIpv6(normalized: number[]): number | null {
	const [g0, g1, g2, g3, g4, g5, g6, g7] = normalized;

	// 6to4: 2002:<ipv4>::/48 — embedded IPv4 is groups 1-2.
	if (g0 === 0x2002) {
		return ((g1 << 16) | g2) >>> 0;
	}
	// Well-known NAT64: 64:ff9b::/96 — embedded IPv4 is the last two groups.
	if (
		g0 === 0x64 &&
		g1 === 0xff9b &&
		g2 === 0 &&
		g3 === 0 &&
		g4 === 0 &&
		g5 === 0
	) {
		return ((g6 << 16) | g7) >>> 0;
	}
	// IPv4-compatible: ::<ipv4> — first six groups zero, last two are the IPv4.
	// Excludes :: and ::1, which have no meaningful embedded address.
	if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
		if (g6 === 0 && g7 <= 1) return null;
		return ((g6 << 16) | g7) >>> 0;
	}
	// IPv4-translated: ::ffff:0:<ipv4> — the SIIT form.
	if (
		g0 === 0 &&
		g1 === 0 &&
		g2 === 0 &&
		g3 === 0 &&
		g4 === 0xffff &&
		g5 === 0
	) {
		return ((g6 << 16) | g7) >>> 0;
	}
	return null;
}

function isBlockedIpv6(host: string): boolean {
	if (!host.includes(':')) return false;
	const normalized = normalizeIpv6(host);
	if (normalized === null) return false;

	// Unspecified :: or loopback ::1 (including non-canonical forms e.g. 0:0:0:0:0:0:0:1)
	const isAllZero = normalized.every(g => g === 0);
	const isLoopback =
		normalized.slice(0, 7).every(g => g === 0) && normalized[7] === 1;
	if (isAllZero || isLoopback) return true;

	const g0 = normalized[0];
	if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
	if ((g0 & 0xffc0) === 0xfec0) return true; // fec0::/10 site-local
	if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast
	if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local

	const embedded = ipv4FromEmbeddedIpv6(normalized);
	if (embedded !== null) return isNonPublicIpv4(embedded);
	return false;
}

const METADATA_HOSTS = new Set([
	'localhost',
	'metadata',
	'metadata.goog',
	'metadata.google.internal',
]);

export function isBlockedFetchHost(hostname: string): boolean {
	// Trailing-dot FQDNs (`localhost.`, `metadata.google.internal.`) are a
	// different hostname string; Node does not strip them.
	const host = hostname.toLowerCase().replace(/\.$/, '');
	if (METADATA_HOSTS.has(host)) return true;
	// RFC 6761 reserves the whole `.localhost` zone for loopback, and
	// systemd-resolved resolves every label under it to 127.0.0.1.
	if (host.endsWith('.localhost')) return true;

	const bare = host.replace(/^\[|\]$/g, '');
	const v4 = parseIpv4(bare) ?? ipv4FromMappedIpv6(bare);
	if (v4 !== null) return isNonPublicIpv4(v4);
	return isBlockedIpv6(bare);
}

export function assertPublicHttpUrl(urlString: string): void {
	let parsed: URL;
	try {
		parsed = new URL(urlString);
	} catch {
		throw new Error(`Invalid URL format: ${urlString}`);
	}

	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
		throw new Error(
			`Invalid URL protocol "${parsed.protocol}". Only http: and https: are supported.`,
		);
	}

	if (isBlockedFetchHost(parsed.hostname)) {
		throw new Error(
			`Cannot fetch from internal/private network address: ${parsed.hostname}`,
		);
	}
}
