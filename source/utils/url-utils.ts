import {isIP} from 'node:net';

function isLocalIPv4(host: string): boolean {
	const [a, b] = host.split('.').map(Number);
	return (
		host === '0.0.0.0' ||
		a === 127 ||
		a === 10 ||
		(a === 172 && b >= 16 && b <= 31) ||
		(a === 192 && b === 168) ||
		(a === 169 && b === 254) ||
		(a === 100 && b >= 64 && b <= 127)
	);
}

/** Classify URL-normalized hostnames without DNS lookups. */
function isLocalHostname(hostname: string): boolean {
	const host = hostname
		.toLowerCase()
		.replace(/\.$/, '')
		.replace(/^\[|\]$/g, '');
	const version = isIP(host);
	if (version === 4) return isLocalIPv4(host);
	if (version === 6) {
		// URL serializes IPv4-mapped addresses as ::ffff:hhhh:hhhh.
		const mapped = /^::ffff:([\da-f]+):([\da-f]+)$/.exec(host);
		if (mapped) {
			const high = Number.parseInt(mapped[1], 16);
			const low = Number.parseInt(mapped[2], 16);
			return isLocalIPv4(
				`${high >>> 8}.${high & 255}.${low >>> 8}.${low & 255}`,
			);
		}
		return host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host);
	}
	return (
		!host.includes('.') ||
		host.endsWith('.localhost') ||
		host.endsWith('.local') ||
		host === 'host.docker.internal'
	);
}

/**
 * Check if a URL points to a local server.
 * Includes loopback, private/link-local IPs, CGNAT and local hostnames.
 */
export function isLocalURL(url: string): boolean {
	try {
		const parsed = new URL(url);
		if (parsed.hostname) {
			return isLocalHostname(parsed.hostname);
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
