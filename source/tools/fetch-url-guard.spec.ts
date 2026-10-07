import test from 'ava';
import {assertPublicHttpUrl} from './fetch-url-guard.js';

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
