/**
 * Reject fetch_url targets that are loopback, private, link-local, or cloud
 * metadata — on the *request* URL only.
 *
 * Known gaps (not this file):
 * - HTTP redirects: `@nanocollective/get-md` fetches with `redirect: "follow"`,
 *   so `http://attacker.example/r` → `http://169.254.169.254/` still returns
 *   the private body. Tracked in #1089.
 * - DNS rebinding: a public name can resolve to a blocked address at request
 *   time; this check is hostname-string / parsed IP, not a pinned lookup.
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

function isPrivateOrLocalIpv4(ip: number): boolean {
	return (
		ipv4InCidr(ip, 0x00000000, 8) || // 0.0.0.0/8
		ipv4InCidr(ip, 0x0a000000, 8) || // 10.0.0.0/8
		ipv4InCidr(ip, 0x64400000, 10) || // 100.64.0.0/10 CGNAT
		ipv4InCidr(ip, 0x7f000000, 8) || // 127.0.0.0/8
		ipv4InCidr(ip, 0xa9fe0000, 16) || // 169.254.0.0/16
		ipv4InCidr(ip, 0xac100000, 12) || // 172.16.0.0/12
		ipv4InCidr(ip, 0xc0a80000, 16) // 192.168.0.0/16
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

function isBlockedIpv6(host: string): boolean {
	if (!host.includes(':')) return false;
	if (host === '::1' || host === '::') return true;
	if (/^fe[89ab]/i.test(host)) return true; // fe80::/10 link-local
	if (/^fe[cdef]/i.test(host)) return true; // fec0::/10 site-local
	if (/^ff/i.test(host)) return true; // ff00::/8 multicast
	if (/^f[cd]/i.test(host)) return true; // fc00::/7 unique-local
	return false;
}

const METADATA_HOSTS = new Set([
	'localhost',
	'metadata',
	'metadata.goog',
	'metadata.google.internal',
]);

function isBlockedFetchHost(hostname: string): boolean {
	// Trailing-dot FQDNs (`localhost.`, `metadata.google.internal.`) are a
	// different hostname string; Node does not strip them.
	const host = hostname.toLowerCase().replace(/\.$/, '');
	if (METADATA_HOSTS.has(host)) return true;
	// RFC 6761 reserves the whole `.localhost` zone for loopback, and
	// systemd-resolved resolves every label under it to 127.0.0.1.
	if (host.endsWith('.localhost')) return true;

	const bare = host.replace(/^\[|\]$/g, '');
	const v4 = parseIpv4(bare) ?? ipv4FromMappedIpv6(bare);
	if (v4 !== null) return isPrivateOrLocalIpv4(v4);
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
