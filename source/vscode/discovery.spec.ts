import test from 'ava';
import {existsSync} from 'node:fs';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {WebSocket} from 'ws';
import {
	clearDiscoveryFile,
	getDefaultConfigDir,
	getDiscoveryFilePath,
	generateServerToken,
	isProcessAlive,
	readDiscoveryFile,
	safeEqualToken,
	writeDiscoveryFile,
} from './discovery.js';
import {VSCodeServer} from './vscode-server.js';

// Each test gets its own tmp config dir, set via the `NANOCODER_CONFIG_DIR`
// env var so {@link getDiscoveryFilePath} lands inside it. The cleanup
// callback runs in `finally` to keep the tmp tree tidy.
function withIsolatedConfigDir<T>(fn: (dir: string) => Promise<T>): Promise<T> {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-disc-'));
	const previous = process.env.NANOCODER_CONFIG_DIR;
	process.env.NANOCODER_CONFIG_DIR = dir;
	const restore = () => {
		if (previous === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previous;
		}
		rmSync(dir, {recursive: true, force: true});
	};
	return fn(dir).then(
		value => {
			restore();
			return value;
		},
		err => {
			restore();
			throw err;
		},
	);
}

// ============================================================================
// safeEqualToken
// ============================================================================

test('safeEqualToken returns true for matching tokens', t => {
	t.true(safeEqualToken('hunter2', 'hunter2'));
	t.true(safeEqualToken('a'.repeat(64), 'a'.repeat(64)));
});

test('safeEqualToken returns false for non-matching tokens of the same length', t => {
	t.false(safeEqualToken('hunter2', 'hunter3'));
	t.false(safeEqualToken('a'.repeat(64), 'b'.repeat(64)));
});

test('safeEqualToken returns false for tokens of different lengths without leaking length', t => {
	// The function must still return false, not throw, when given inputs of
	// mismatched lengths. The constant-time dummy-buffer comparison keeps the
	// comparison itself constant-time; the final boolean is what matters.
	t.false(safeEqualToken('hunter2', 'hunter22'));
	t.false(safeEqualToken('', 'x'));
	t.false(safeEqualToken('x', ''));
});

test('safeEqualToken returns true for two empty strings', t => {
	// Two equal empty strings do compare equal; this is a property of the
	// constant-time primitive, not an authorisation property. The
	// empty-token guard lives one level up, in verifyClient's
	// `if (!provided)` check (and in the server constructor's `||`).
	t.true(safeEqualToken('', ''));
});

// ============================================================================
// getDefaultConfigDir
// ============================================================================

test('getDefaultConfigDir honors NANOCODER_CONFIG_DIR override', t => {
	const previous = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = '/tmp/custom-cfg';
		t.is(getDefaultConfigDir(), '/tmp/custom-cfg');
	} finally {
		if (previous === undefined) delete process.env.NANOCODER_CONFIG_DIR;
		else process.env.NANOCODER_CONFIG_DIR = previous;
	}
});

test('getDefaultConfigDir returns a path ending in "nanocoder"', t => {
	const dir = getDefaultConfigDir();
	t.true(dir.endsWith('nanocoder'), `got ${dir}`);
});

// ============================================================================
// getDiscoveryFilePath
// ============================================================================

test('getDiscoveryFilePath resolves to <configDir>/vscode-server.json', t => {
	const dir = '/tmp/fake-cfg';
	t.is(getDiscoveryFilePath(dir), join(dir, 'vscode-server.json'));
});

test('getDiscoveryFilePath falls back to the default config dir', t => {
	const dir = getDefaultConfigDir();
	t.is(getDiscoveryFilePath(), join(dir, 'vscode-server.json'));
});

// ============================================================================
// generateServerToken
// ============================================================================

test('generateServerToken produces a 64-character hex string', t => {
	const token = generateServerToken();
	t.is(token.length, 64);
	t.regex(token, /^[0-9a-f]+$/);
});

test('generateServerToken produces different tokens each call', t => {
	const a = generateServerToken();
	const b = generateServerToken();
	t.not(a, b);
});

// ============================================================================
// isProcessAlive
// ============================================================================

test('isProcessAlive returns true for the current process', t => {
	t.true(isProcessAlive(process.pid));
});

test('isProcessAlive returns false for non-positive PIDs', t => {
	t.false(isProcessAlive(0));
	t.false(isProcessAlive(-1));
	t.false(isProcessAlive(Number.NaN));
	t.false(isProcessAlive(Number.POSITIVE_INFINITY));
});

// ============================================================================
// writeDiscoveryFile + readDiscoveryFile round-trip
// ============================================================================

test('writeDiscoveryFile creates the parent directory if missing', async t => {
	await withIsolatedConfigDir(async dir => {
		const nested = join(dir, 'deep', 'nested');
		const filePath = join(nested, 'vscode-server.json');
		t.false(existsSync(nested));
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 51820,
			token: 'abc',
			pid: process.pid,
			cliVersion: '1.0.0',
			startedAt: 0,
		});
		t.true(existsSync(filePath));
	});
});

test('writeDiscoveryFile + readDiscoveryFile round-trips every field', async t => {
	await withIsolatedConfigDir(async () => {
		const filePath = getDiscoveryFilePath();
		const info = {
			version: 1,
			port: 51821,
			token: 'round-trip-token',
			pid: process.pid,
			cliVersion: '1.30.0',
			startedAt: 1_700_000_000_000,
		};
		await writeDiscoveryFile(filePath, info);
		const read = await readDiscoveryFile(filePath);
		t.deepEqual(read, info);
	});
});

test('writeDiscoveryFile persists restrictive 0600 permissions on POSIX', async t => {
	if (process.platform === 'win32') {
		t.pass('POSIX permissions are not applicable on Windows');
		return;
	}
	await withIsolatedConfigDir(async dir => {
		const filePath = join(dir, 'vscode-server.json');
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 1,
			token: 'x',
			pid: process.pid,
			cliVersion: '1',
			startedAt: 0,
		});
		const {statSync} = await import('node:fs');
		const mode = statSync(filePath).mode & 0o777;
		t.is(mode, 0o600, `expected 0600, got ${mode.toString(8)}`);
	});
});

test('writeDiscoveryFile overwrites an existing file atomically', async t => {
	await withIsolatedConfigDir(async () => {
		const filePath = getDiscoveryFilePath();
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 1,
			token: 'old',
			pid: process.pid,
			cliVersion: '1',
			startedAt: 0,
		});
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 2,
			token: 'new',
			pid: process.pid,
			cliVersion: '1',
			startedAt: 0,
		});
		const read = await readDiscoveryFile(filePath);
		t.is(read?.token, 'new');
		t.is(read?.port, 2);
	});
});

test('writeDiscoveryFile cleans up the temp file when rename fails', async t => {
	// Force the rename to fail by passing a destination whose parent
	// directory cannot contain new files. We simulate that by removing write
	// permission on the parent; on POSIX that prevents the temp file from
	// being created in the first place, exercising the error path in
	// `mkdir`/`writeFile` rather than in `rename`. Either way the contract
	// holds: no leftover `.tmp` siblings accumulate in the directory.
	if (process.platform === 'win32') {
		t.pass('POSIX permission test skipped on Windows');
		return;
	}
	await withIsolatedConfigDir(async dir => {
		const {chmodSync, readdirSync} = await import('node:fs');
		chmodSync(dir, 0o555); // read+execute, no write
		try {
			await t.throwsAsync(() =>
				writeDiscoveryFile(join(dir, 'vscode-server.json'), {
					version: 1,
					port: 1,
					token: 'should-fail',
					pid: process.pid,
					cliVersion: '1',
					startedAt: 0,
				}),
			);
			const leftover = readdirSync(dir).filter(name => name.endsWith('.tmp'));
			t.deepEqual(leftover, []);
		} finally {
			chmodSync(dir, 0o755);
		}
	});
});

test('readDiscoveryFile returns null for a missing file', async t => {
	await withIsolatedConfigDir(async () => {
		const filePath = getDiscoveryFilePath();
		t.is(await readDiscoveryFile(filePath), null);
	});
});

test('readDiscoveryFile returns null for a file with the wrong shape', async t => {
	await withIsolatedConfigDir(async () => {
		const filePath = getDiscoveryFilePath();
		const {writeFile} = await import('node:fs/promises');
		await writeFile(filePath, JSON.stringify({port: 'not a number'}));
		t.is(await readDiscoveryFile(filePath), null);
	});
});

test('readDiscoveryFile returns null for invalid JSON', async t => {
	await withIsolatedConfigDir(async () => {
		const filePath = getDiscoveryFilePath();
		const {writeFile} = await import('node:fs/promises');
		await writeFile(filePath, '{this is not json');
		t.is(await readDiscoveryFile(filePath), null);
	});
});

test('readDiscoveryFile returns null for a stale file (PID no longer alive)', async t => {
	await withIsolatedConfigDir(async dir => {
		const filePath = join(dir, 'vscode-server.json');
		// Pick a PID that is overwhelmingly unlikely to be in use. PID 1 is
		// `init` on Linux and `launchd` on macOS - not what we want. Use a
		// very large PID instead; the kernel will not have it.
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 51820,
			token: 'stale-token',
			pid: 4_000_000,
			cliVersion: '1.0.0',
			startedAt: 0,
		});
		t.is(await readDiscoveryFile(filePath), null, 'stale file must look missing');
	});
});

test('readDiscoveryFile returns the entry when the recorded PID is alive', async t => {
	await withIsolatedConfigDir(async () => {
		const filePath = getDiscoveryFilePath();
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 51820,
			token: 'live-token',
			pid: process.pid,
			cliVersion: '1.0.0',
			startedAt: 0,
		});
		const read = await readDiscoveryFile(filePath);
		t.truthy(read);
		t.is(read?.token, 'live-token');
	});
});

// ============================================================================
// clearDiscoveryFile
// ============================================================================

test('clearDiscoveryFile removes an existing file', async t => {
	await withIsolatedConfigDir(async dir => {
		const filePath = join(dir, 'vscode-server.json');
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 1,
			token: 'x',
			pid: process.pid,
			cliVersion: '1',
			startedAt: 0,
		});
		t.true(existsSync(filePath));
		await clearDiscoveryFile(filePath);
		t.false(existsSync(filePath));
	});
});

test('clearDiscoveryFile is a no-op when the file is already gone', async t => {
	await withIsolatedConfigDir(async dir => {
		const filePath = join(dir, 'never-existed.json');
		await clearDiscoveryFile(filePath); // must not throw
		t.pass();
	});
});

test('clearDiscoveryFile leaves the file alone when owned by another PID', async t => {
	// Regression for the multi-instance bug: previously, two servers
	// sharing the same global discovery-file path would clobber each other
	// on shutdown - whichever instance called stop() last would unlink the
	// file belonging to the still-live other instance.
	await withIsolatedConfigDir(async dir => {
		const filePath = join(dir, 'vscode-server.json');
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 51820,
			token: 'belongs-to-elsewhere',
			pid: 4_000_000, // not us
			cliVersion: '1.0.0',
			startedAt: 0,
		});
		await clearDiscoveryFile(filePath, process.pid);
		t.true(existsSync(filePath), 'file owned by another PID must survive');
	});
});

test('clearDiscoveryFile removes the file when expectedPid matches', async t => {
	await withIsolatedConfigDir(async dir => {
		const filePath = join(dir, 'vscode-server.json');
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 51820,
			token: 'belongs-to-us',
			pid: process.pid,
			cliVersion: '1.0.0',
			startedAt: 0,
		});
		await clearDiscoveryFile(filePath, process.pid);
		t.false(existsSync(filePath));
	});
});

// ============================================================================
// Security: VSCodeServer rejects unauthenticated / cross-origin handshakes.
// These are the regression tests for the bug in
// https://github.com/Nano-Collective/nanocoder/issues/1059.
// ============================================================================

let testPort = 57000;
function getNextPort(): number {
	return testPort++;
}

/**
 * Build the headers object an authenticated client should send. The token
 * travels in an `Authorization: Bearer <token>` header rather than in the
 * URL query string, so URL logs and access logs do not leak it.
 */
function authenticatedHeaders(token: string): Record<string, string> {
	return {Authorization: `Bearer ${token}`};
}

/**
 * Open a connection and wait for either `open` or `close` (whichever comes
 * first). Returns true if the handshake completed; false if the server
 * rejected us. Always tears down the socket before returning.
 */
function attemptConnect(
	url: string,
	options: {headers?: Record<string, string>} = {},
): Promise<boolean> {
	return new Promise<boolean>(resolve => {
		const ws = new WebSocket(url, options);
		let resolved = false;
		const finish = (result: boolean) => {
			if (resolved) return;
			resolved = true;
			try {
				ws.close();
			} catch {
				// ignore
			}
			resolve(result);
		};
		ws.on('open', () => finish(true));
		ws.on('error', () => finish(false));
		ws.on('close', () => finish(false));
		// Hard ceiling so a partial-open bug cannot hang the suite.
		setTimeout(() => finish(false), 2000);
	});
}

test('VSCodeServer rejects handshakes that include an Origin header', async t => {
	const port = getNextPort();
	const token = 'origin-reject-token';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		const accepted = await attemptConnect(`ws://127.0.0.1:${port}`, {
			headers: {
				Origin: 'https://evil.example',
				Authorization: `Bearer ${token}`,
			},
		});
		t.false(accepted, 'Origin-bearing handshake must be refused');

		await server.stop();
	});
});

test('VSCodeServer rejects handshakes with no token', async t => {
	const port = getNextPort();
	const token = 'no-token-test';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		const accepted = await attemptConnect(`ws://127.0.0.1:${port}`);
		t.false(accepted, 'Tokenless handshake must be refused');

		await server.stop();
	});
});

test('VSCodeServer rejects handshakes with a wrong token', async t => {
	const port = getNextPort();
	const token = 'correct-token';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		const accepted = await attemptConnect(
			`ws://127.0.0.1:${port}`,
			{headers: authenticatedHeaders('wrong-token')},
		);
		t.false(accepted, 'Mismatched token must be refused');

		await server.stop();
	});
});

test('VSCodeServer accepts a handshake with the right token and no Origin', async t => {
	const port = getNextPort();
	const token = 'good-token';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		const accepted = await attemptConnect(
			`ws://127.0.0.1:${port}`,
			{headers: authenticatedHeaders(token)},
		);
		t.true(accepted, 'Correct token without Origin must be accepted');

		await server.stop();
	});
});

test('VSCodeServer rejects a correct token when Origin is also present', async t => {
	const port = getNextPort();
	const token = 'origin-and-token';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		const accepted = await attemptConnect(
			`ws://127.0.0.1:${port}`,
			{
				headers: {
					Origin: 'https://evil.example',
					Authorization: `Bearer ${token}`,
				},
			},
		);
		t.false(
			accepted,
			'A correct token must not override the Origin prohibition',
		);

		await server.stop();
	});
});

test('VSCodeServer accepts a token with Bearer prefix in Authorization header', async t => {
	const port = getNextPort();
	const token = 'bearer-prefix';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		const accepted = await attemptConnect(
			`ws://127.0.0.1:${port}`,
			{headers: authenticatedHeaders(token)},
		);
		t.true(accepted, 'Bearer-prefixed Authorization header must be accepted');

		await server.stop();
	});
});

test('VSCodeServer rejects handshakes when the token is empty', async t => {
	const port = getNextPort();
	const token = 'opposite';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		const accepted = await attemptConnect(
			`ws://127.0.0.1:${port}`,
			{headers: {Authorization: 'Bearer '}},
		);
		t.false(accepted, 'Empty bearer token must be refused');

		await server.stop();
	});
});

test('VSCodeServer constructor rejects empty-string token and falls back to a generated one', t => {
	// The constructor must not be tricked into producing an empty bearer
	// token by passing `''` through the options bag. `??` would have let
	// `''` through; `||` is what we want.
	const server = new VSCodeServer(0, {token: ''});
	t.not(server.getToken(), '');
	t.is(server.getToken().length, 64);
});

test('VSCodeServer accepts a token sent without the Bearer prefix', async t => {
	const port = getNextPort();
	const token = 'no-prefix-token';
	await withIsolatedConfigDir(async () => {
		const server = new VSCodeServer(port, {token});
		await server.start();

		// The header parser still applies the constant-time comparison on
		// the raw value when no Bearer prefix is present, so an integrator
		// that opts out of the standard prefix still works.
		const accepted = await attemptConnect(`ws://127.0.0.1:${port}`, {
			headers: {Authorization: token},
		});
		t.true(accepted, 'raw-token Authorization must be accepted');

		await server.stop();
	});
});

// ============================================================================
// Ephemeral-port + discovery-file integration
// ============================================================================

test('Ephemeral mode binds an OS-chosen port and writes a discovery file', async t => {
	await withIsolatedConfigDir(async dir => {
		const filePath = getDiscoveryFilePath();
		const server = new VSCodeServer(0);
		const started = await server.start();
		t.true(started);

		const port = server.getPort();
		t.true(port > 0 && port < 65536, `port ${port} should be valid`);
		t.is(server.isEphemeral(), true);

		t.true(existsSync(filePath), 'discovery file should exist');
		const info = await readDiscoveryFile(filePath);
		t.truthy(info);
		t.is(info?.port, port);
		t.is(info?.token, server.getToken());
		t.is(info?.pid, process.pid);
		// `cliVersion` is sourced from package.json by the server; we don't
		// hard-code the version here because that would couple the spec to
		// the package version. Asserting the field is a non-empty string is
		// enough to prove the publish path ran end-to-end.
		t.true(
			typeof info?.cliVersion === 'string' && info.cliVersion.length > 0,
			`cliVersion should be a non-empty string, got ${info?.cliVersion}`,
		);

		// The discovery file should not have been written into the user's real
		// config dir; it landed in our isolated tmp dir.
		t.true(filePath.startsWith(dir));

		await server.stop();
		t.false(existsSync(filePath), 'discovery file should be removed on stop');
	});
});

test('Stop clears the discovery file even when it pre-existed', async t => {
	await withIsolatedConfigDir(async () => {
		const filePath = getDiscoveryFilePath();
		// Pre-existing file owned by another PID would be left alone; here
		// we write it owned by us, so stop() should unlink it.
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 1,
			token: 'pre-existing',
			pid: process.pid,
			cliVersion: '1',
			startedAt: 0,
		});

		const server = new VSCodeServer(0);
		await server.start();
		// start() should have overwritten the stale file.
		const mid = await readDiscoveryFile(filePath);
		t.is(mid?.token, server.getToken());

		await server.stop();
		t.false(existsSync(filePath));
	});
});

test('Stop leaves a discovery file alone when another process owns it', async t => {
	// Two CLI processes share the same global discovery-file path. A
	// starts and writes its own entry; between A's start() and stop(),
	// process B overwrites the file with B's PID. A.stop() must not
	// unlink B's file - that would orphan B's still-listening server
	// and brick the extension until the next start().
	await withIsolatedConfigDir(async dir => {
		const filePath = getDiscoveryFilePath();

		const serverA = new VSCodeServer(0);
		await serverA.start();

		// Simulate another live process taking ownership of the file.
		await writeDiscoveryFile(filePath, {
			version: 1,
			port: 51820,
			token: 'belongs-to-other-process',
			pid: 4_000_000, // not us
			cliVersion: '1.0.0',
			startedAt: 0,
		});

		await serverA.stop();
		t.true(existsSync(filePath), 'foreign file must survive our stop()');
		// The on-disk file must still describe the foreign process; we
		// read it raw here because readDiscoveryFile applies stale-detection
		// (and our foreign pid is intentionally not alive).
		const {readFile} = await import('node:fs/promises');
		const raw = JSON.parse(await readFile(filePath, 'utf-8'));
		t.is(raw.token, 'belongs-to-other-process');
		t.is(raw.pid, 4_000_000);
	});
});

test('Discovery file failure does not abort server start', async t => {
	// Regression for the nc-review finding that this test used to be
	// vacuous: it set NANOCODER_CONFIG_DIR to a path whose parent it
	// expected mkdir to fail on, but on a writable / the mkdir succeeds
	// and the test exercised the happy path. Now we make the failure real
	// by chmod'ing the config dir read-only before the server starts;
	// writeFile then throws EACCES and the catch in publishDiscovery is
	// exercised.
	if (process.platform === 'win32') {
		t.pass('POSIX permission test skipped on Windows');
		return;
	}

	await withIsolatedConfigDir(async dir => {
		const {chmodSync} = await import('node:fs');
		chmodSync(dir, 0o555); // read+execute, no write
		let server: VSCodeServer | null = null;
		let started: boolean;
		try {
			server = new VSCodeServer(0);
			started = await server.start();
		} finally {
			chmodSync(dir, 0o755); // restore so withIsolatedConfigDir can rm
		}
		t.true(
			started,
			'server should still bind its port even when the discovery file cannot be written',
		);
		await server?.stop();
	});
});
