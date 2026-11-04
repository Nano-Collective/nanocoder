import test from 'ava';
import {
	assertPublicHttpUrl,
	isBlockedFetchHost,
	normalizeIpv6,
} from './fetch-url-guard.js';

test('assertPublicHttpUrl allows public http(s)', t => {
	t.notThrows(() => assertPublicHttpUrl('https://example.com/docs'));
	t.notThrows(() => assertPublicHttpUrl('https://example.com./docs'));
	t.notThrows(() => assertPublicHttpUrl('http://8.8.8.8'));
	t.notThrows(() => assertPublicHttpUrl('http://10.example.com'));
	t.notThrows(() => assertPublicHttpUrl('http://fc.google.com'));
	t.notThrows(() => assertPublicHttpUrl('http://172.32.0.1'));
	t.notThrows(() => assertPublicHttpUrl('http://localhost.example.com'));
	t.notThrows(() => assertPublicHttpUrl('http://mylocalhost.dev'));
});

test('assertPublicHttpUrl rejects format and non-http', t => {
	t.throws(() => assertPublicHttpUrl('not a url'), {message: /Invalid URL format/});
	t.throws(() => assertPublicHttpUrl('ftp://example.com'), {
		message: /Invalid URL protocol/,
	});
});

test('assertPublicHttpUrl rejects loopback, metadata, RFC1918, IPv6 local', t => {
	const blocked = [
		'http://127.0.0.2',
		'http://100.64.0.1',
		'http://169.254.169.254/latest/meta-data/',
		'http://metadata.google.internal',
		'http://metadata.google.internal./',
		'http://metadata.goog',
		'http://metadata.goog./',
		'http://metadata/',
		'http://metadata./',
		'http://localhost:3000',
		'http://localhost./',
		'http://foo.localhost',
		'http://api.dev.localhost:8080/',
		'http://foo.localhost./',
		'http://10.0.0.1',
		'http://192.168.1.1',
		'http://172.16.0.1',
		'http://[::1]',
		'http://[0:0:0:0:0:0:0:1]', // non-canonical loopback spelling
		'http://[::ffff:127.0.0.2]',
		'http://[fe80::1]',
		'http://[fec0::1]',
		'http://[ff02::1]',
		'http://[fd12:3456:789a::1]',
	];
	for (const url of blocked) {
		t.throws(() => assertPublicHttpUrl(url), {
			message: /internal\/private network/,
		});
	}
});

test('assertPublicHttpUrl rejects IPv4 ranges outside RFC1918', t => {
	const blocked = [
		'http://192.0.0.1', // 192.0.0.0/24
		'http://192.0.2.1', // TEST-NET-1, documentation
		'http://198.18.0.1', // benchmarking
		'http://198.51.100.1', // TEST-NET-2, documentation
		'http://203.0.113.1', // TEST-NET-3, documentation
		'http://224.0.0.1', // multicast
		'http://240.0.0.1', // reserved
		'http://255.255.255.255', // limited broadcast
	];
	for (const url of blocked) {
		t.throws(() => assertPublicHttpUrl(url), {
			message: /internal\/private network/,
		});
	}
});

test('assertPublicHttpUrl rejects private IPv4 embedded in IPv6 spellings', t => {
	// WHATWG URL parser normalises dotted tails inside IPv6 brackets into hex groups
	// (e.g. [::127.0.0.1] -> [::7f00:1]), which are then decoded and checked.
	const blocked = [
		'http://[::127.0.0.1]/', // IPv4-compatible (normalised to [::7f00:1])
		'http://[64:ff9b::7f00:1]/', // NAT64 well-known prefix (hex form)
		'http://[2002:7f00:1::]/', // 6to4
		'http://[::ffff:0:7f00:1]/', // IPv4-translated (hex form)
		'http://[::ffff:0:127.0.0.1]/', // IPv4-translated (dotted input, normalised to hex)
		'http://[::7f00:1]/', // IPv4-compatible (hex form)
		'http://[64:ff9b::127.0.0.1]/', // NAT64 (dotted input, normalised to hex)
		'http://[2002:7f00:1::1]', // 6to4 with trailing host bits
	];
	for (const url of blocked) {
		t.throws(() => assertPublicHttpUrl(url), {
			message: /internal\/private network/,
		});
	}
});

test('assertPublicHttpUrl allows public IPv4 embedded in IPv6 spellings', t => {
	const allowed = [
		'http://[::8.8.8.8]/', // IPv4-compatible, public (normalised to hex)
		'http://[64:ff9b::8.8.8.8]/', // NAT64, public (normalised to hex)
		'http://[2002:0808:0808::]/', // 6to4, public
		'http://[::ffff:0:8.8.8.8]/', // IPv4-translated, public (normalised to hex)
		'http://[::8.8.8.8]',
		'http://[2001:4860:4860::8888]', // public IPv6
	];
	for (const url of allowed) {
		t.notThrows(() => assertPublicHttpUrl(url));
	}
});

test('normalizeIpv6 expands raw dotted-quad and compressed IPv6 forms', t => {
	// Direct unit tests for the dotted-quad branch in normalizeIpv6
	t.deepEqual(normalizeIpv6('::ffff:0:127.0.0.1'), [
		0, 0, 0, 0, 0xffff, 0, 0x7f00, 1,
	]);
	t.deepEqual(normalizeIpv6('64:ff9b::127.0.0.1'), [
		0x64, 0xff9b, 0, 0, 0, 0, 0x7f00, 1,
	]);
	t.deepEqual(normalizeIpv6('::127.0.0.1'), [
		0, 0, 0, 0, 0, 0, 0x7f00, 1,
	]);
	t.deepEqual(normalizeIpv6('::1'), [0, 0, 0, 0, 0, 0, 0, 1]);
	t.deepEqual(normalizeIpv6('::'), [0, 0, 0, 0, 0, 0, 0, 0]);
	t.deepEqual(normalizeIpv6('0:0:0:0:0:0:0:1'), [0, 0, 0, 0, 0, 0, 0, 1]);
	t.is(normalizeIpv6('not-an-ip'), null);
	t.is(normalizeIpv6('127.0.0.1'), null);
});

test('isBlockedFetchHost catches non-canonical IPv6 loopback spellings', t => {
	t.true(isBlockedFetchHost('0:0:0:0:0:0:0:1'));
	t.true(isBlockedFetchHost('::0.0.0.1'));
	t.true(isBlockedFetchHost('0:0:0:0:0:0:0:0'));
});
