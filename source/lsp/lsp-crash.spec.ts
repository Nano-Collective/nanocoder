import type {ChildProcess} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {type LSPCrashInfo, LSPClient, type LSPServerConfig} from './lsp-client';
import {LSPManager} from './lsp-manager';

console.log(`\nlsp-crash.spec.ts`);

// A minimal language server: answers `initialize` (advertising pull
// diagnostics) and `shutdown`, exits on `exit`, and never answers anything
// else, so a diagnostics request stays in flight until the server dies.
const FAKE_SERVER = `
process.stderr.write('fake-lsp: starting\\n');
let buf = '';
const reply = (id, result, error) => {
	const body = JSON.stringify({jsonrpc: '2.0', id, result, error});
	process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
};
process.stdin.on('data', chunk => {
	buf += chunk;
	for (;;) {
		const end = buf.indexOf('\\r\\n\\r\\n');
		if (end === -1) return;
		const len = Number(/Content-Length: (\\d+)/i.exec(buf.slice(0, end))[1]);
		if (buf.length < end + 4 + len) return;
		const msg = JSON.parse(buf.slice(end + 4, end + 4 + len));
		buf = buf.slice(end + 4 + len);
		if (msg.method === 'initialize' && process.env.FAKE_LSP_REFUSE_INIT) {
			// Like typescript-language-server without a usable TypeScript: refuse,
			// but keep running.
			reply(msg.id, undefined, {code: 1, message: 'no tsserver.js'});
		} else if (msg.method === 'initialize') {
			reply(msg.id, {capabilities: {diagnosticProvider: {}}});
			process.stderr.write('fatal: out of memory\\n');
		} else if (msg.method === 'shutdown') reply(msg.id, null);
		else if (msg.method === 'exit') process.exit(0);
	}
});
`;

let fixtureDir: string;
let serverConfig: LSPServerConfig;

test.before(() => {
	fixtureDir = mkdtempSync(join(tmpdir(), 'nanocoder-lsp-crash-'));
	const script = join(fixtureDir, 'fake-lsp.js');
	writeFileSync(script, FAKE_SERVER);
	serverConfig = {
		name: 'fake-lsp',
		command: process.execPath,
		args: [script],
		languages: ['fake'],
	};
});

test.after.always(() => {
	rmSync(fixtureDir, {recursive: true, force: true});
});

function serverProcess(client: LSPClient): ChildProcess {
	return (client as unknown as {process: ChildProcess}).process;
}

function nextEvent<T>(emitter: LSPClient, event: string): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error(`no '${event}' event`)),
			5000,
		);
		emitter.once(event, (value: T) => {
			clearTimeout(timer);
			resolve(value);
		});
	});
}

/** Poll until `check` passes, since a restart completes asynchronously. */
async function waitFor(check: () => boolean): Promise<void> {
	const deadline = Date.now() + 5000;
	while (!check()) {
		if (Date.now() > deadline) throw new Error('condition not met');
		await new Promise(resolve => setTimeout(resolve, 20));
	}
}

test.serial(
	'a crash fails in-flight requests at once and reports stderr',
	async t => {
		const client = new LSPClient(serverConfig);
		await client.start();
		const crashed = nextEvent<LSPCrashInfo>(client, 'crash');

		const started = Date.now();
		const request = client.getDiagnostics('file:///a.fake');
		serverProcess(client).kill('SIGKILL');

		const error = await t.throwsAsync(request);
		t.regex(error!.message, /fake-lsp" crashed \(signal SIGKILL\)/);
		// Well short of the 30s request timeout.
		t.true(Date.now() - started < 5000);

		const info = await crashed;
		t.is(info.signal, 'SIGKILL');
		t.regex(info.stderrTail, /fatal: out of memory/);
		t.false(client.isReady());
	},
);

test.serial('stop() is not reported as a crash', async t => {
	const client = new LSPClient(serverConfig);
	await client.start();
	let crashed = false;
	client.on('crash', () => {
		crashed = true;
	});
	const exited = nextEvent(client, 'exit');

	await client.stop();
	await exited;

	t.false(crashed);
});

test.serial('a missing binary rejects start() without throwing', async t => {
	const client = new LSPClient({
		...serverConfig,
		command: join(fixtureDir, 'does-not-exist'),
	});
	// No 'error' listener on purpose: an unguarded emit would throw.
	await t.throwsAsync(client.start(), {code: 'ENOENT'});
});

test.serial(
	'a server that refuses initialize is stopped, not reported as a crash',
	async t => {
		const client = new LSPClient({
			...serverConfig,
			env: {FAKE_LSP_REFUSE_INIT: '1'},
		});
		let crashed = false;
		client.on('crash', () => {
			crashed = true;
		});
		const exited = nextEvent(client, 'exit');

		await t.throwsAsync(client.start(), {message: /no tsserver\.js/});
		// Without the cleanup the process stays alive and this never fires.
		await exited;

		t.false(crashed);
	},
);

test.serial(
	'the manager restarts a crashed server once, then leaves it down',
	async t => {
		const manager = new LSPManager({rootUri: `file://${fixtureDir}`});
		await manager.initialize({autoDiscover: false, servers: [serverConfig]});
		const clients = (manager as unknown as {clients: Map<string, LSPClient>})
			.clients;
		const first = clients.get('fake-lsp')!;

		serverProcess(first).kill('SIGKILL');
		await waitFor(() => {
			const current = clients.get('fake-lsp');
			return current !== undefined && current !== first && current.isReady();
		});
		t.true(manager.hasLanguageSupport('a.fake'));

		serverProcess(clients.get('fake-lsp')!).kill('SIGKILL');
		await waitFor(() => !clients.has('fake-lsp'));
		// Give a (wrong) second restart the chance to happen before asserting.
		await new Promise(resolve => setTimeout(resolve, 200));

		t.deepEqual(manager.getConnectedServers(), []);
		t.false(manager.hasLanguageSupport('a.fake'));
		await manager.shutdown();
	},
);

test.serial('a crash drops the diagnostics that server published', async t => {
	const manager = new LSPManager({rootUri: `file://${fixtureDir}`});
	await manager.initialize({autoDiscover: false, servers: [serverConfig]});
	const internals = manager as unknown as {
		clients: Map<string, LSPClient>;
		diagnosticsCache: Map<string, unknown[]>;
	};
	const stale = [
		{
			range: {
				start: {line: 0, character: 0},
				end: {line: 0, character: 1},
			},
			message: 'stale',
		},
	];
	internals.diagnosticsCache.set('file:///x/a.fake', stale);
	internals.diagnosticsCache.set('file:///x/b.ts', stale);

	const client = internals.clients.get('fake-lsp')!;
	const crashed = nextEvent(client, 'crash');
	serverProcess(client).kill('SIGKILL');
	await crashed;

	t.false(internals.diagnosticsCache.has('file:///x/a.fake'));
	// Another server's diagnostics are untouched.
	t.true(internals.diagnosticsCache.has('file:///x/b.ts'));
	await manager.shutdown();
});
