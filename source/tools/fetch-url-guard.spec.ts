import test from 'ava';
import {
	assertPublicHttpUrl,
	assertResolvedPublicHttpUrl,
	hostResolver,
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

// --- Names that resolve to internal addresses (#1662) ---
// A fake resolver stands in for DNS, so none of this depends on the network.

const withResolver = async (
	table: Record<string, string[]>,
	run: () => Promise<void>,
) => {
	const original = hostResolver.resolve;
	hostResolver.resolve = async host => {
		const addresses = table[host];
		if (!addresses) throw new Error(`getaddrinfo ENOTFOUND ${host}`);
		return addresses;
	};
	try {
		await run();
	} finally {
		hostResolver.resolve = original;
	}
};

test.serial('assertResolvedPublicHttpUrl allows names that resolve to public addresses', async t => {
	await withResolver(
		{
			'docs.example.test': ['93.184.216.34'],
			'dual.example.test': ['93.184.216.34', '2606:2800:220:1::1'],
		},
		async () => {
			await t.notThrowsAsync(() =>
				assertResolvedPublicHttpUrl('https://docs.example.test/page'),
			);
			await t.notThrowsAsync(() =>
				assertResolvedPublicHttpUrl('http://dual.example.test:8080/'),
			);
		},
	);
});

test.serial('assertResolvedPublicHttpUrl rejects names that resolve to internal addresses', async t => {
	const table = {
		'localtest.me': ['127.0.0.1'],
		'169.254.169.254.nip.io': ['169.254.169.254'],
		'v6.example.test': ['::1'],
		'mapped.example.test': ['::ffff:127.0.0.1'],
		'lan.example.test': ['192.168.1.10'],
		'cgnat.example.test': ['100.64.0.1'],
		'linklocal.example.test': ['fe80::1'],
		'ula.example.test': ['fd12:3456:789a::1'],
	};
	await withResolver(table, async () => {
		for (const host of Object.keys(table)) {
			await t.throwsAsync(
				() => assertResolvedPublicHttpUrl(`http://${host}:18080/admin`),
				{message: /internal\/private network address: .* resolves to /},
				host,
			);
		}
	});
});

test.serial('assertResolvedPublicHttpUrl rejects a name with one public and one private address', async t => {
	await withResolver(
		{'mixed.example.test': ['93.184.216.34', '127.0.0.1']},
		async () => {
			await t.throwsAsync(
				() => assertResolvedPublicHttpUrl('http://mixed.example.test/'),
				{message: /resolves to 127\.0\.0\.1/},
			);
		},
	);
});

test.serial('assertResolvedPublicHttpUrl does not look up IP literals and still blocks them', async t => {
	// An empty table makes any lookup throw ENOTFOUND, so a lookup would show up
	// as the wrong error.
	await withResolver({}, async () => {
		await t.notThrowsAsync(() => assertResolvedPublicHttpUrl('http://8.8.8.8/'));
		await t.throwsAsync(() => assertResolvedPublicHttpUrl('http://127.0.0.1/'), {
			message: /internal\/private network address: 127\.0\.0\.1$/,
		});
		await t.throwsAsync(() => assertResolvedPublicHttpUrl('http://[::1]/'), {
			message: /internal\/private network/,
		});
	});
});

test.serial('assertResolvedPublicHttpUrl keeps the text checks', async t => {
	await withResolver({}, async () => {
		await t.throwsAsync(() => assertResolvedPublicHttpUrl('not a url'), {
			message: /Invalid URL format/,
		});
		await t.throwsAsync(() => assertResolvedPublicHttpUrl('ftp://example.com'), {
			message: /Invalid URL protocol/,
		});
		await t.throwsAsync(() => assertResolvedPublicHttpUrl('http://localhost:3000'), {
			message: /internal\/private network/,
		});
	});
});

test.serial('assertResolvedPublicHttpUrl rejects a name that does not resolve', async t => {
	await withResolver({}, async () => {
		await t.throwsAsync(
			() => assertResolvedPublicHttpUrl('http://nxdomain.example.test/'),
			{message: /ENOTFOUND/},
		);
	});
});
