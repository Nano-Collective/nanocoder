import {mkdtempSync, realpathSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {resetSessionCwd, setSessionCwd} from '@/services/session-cwd';
import {getDiagnosticsTool} from '@/tools/lsp-get-diagnostics';
import type {LSPServerConfig} from './lsp-client';
import {getLSPManager, LSPManager, resetLSPManager} from './lsp-manager';

console.log(`\nlsp-diagnostics-wait.spec.ts`);

// A push-only language server, like typescript-language-server: it checks a
// document some time after didOpen/didChange and then publishes diagnostics
// for the URI it was given. The message counts the notifications it got.
const FAKE_SERVER = `
let buf = '';
let opens = 0;
let changes = 0;
const send = msg => {
	const body = JSON.stringify({jsonrpc: '2.0', ...msg});
	process.stdout.write('Content-Length: ' + Buffer.byteLength(body) + '\\r\\n\\r\\n' + body);
};
const publish = uri => setTimeout(() => send({
	method: 'textDocument/publishDiagnostics',
	params: {uri, diagnostics: [{
		range: {start: {line: 0, character: 6}, end: {line: 0, character: 7}},
		severity: 1,
		source: 'fake',
		message: 'opens=' + opens + ' changes=' + changes,
	}]},
}), 300);
process.stdin.on('data', chunk => {
	buf += chunk;
	for (;;) {
		const end = buf.indexOf('\\r\\n\\r\\n');
		if (end === -1) return;
		const len = Number(/Content-Length: (\\d+)/i.exec(buf.slice(0, end))[1]);
		if (buf.length < end + 4 + len) return;
		const msg = JSON.parse(buf.slice(end + 4, end + 4 + len));
		buf = buf.slice(end + 4 + len);
		if (msg.method === 'initialize' && process.env.FAKE_LSP_NO_TS) {
			process.stderr.write('Could not find a valid TypeScript installation. Please ensure that the "typescript" dependency is installed.\\n');
			send({id: msg.id, error: {code: -32603, message: 'Request initialize failed with message: no tsserver'}});
		} else if (msg.method === 'initialize') send({id: msg.id, result: {capabilities: {}}});
		else if (msg.method === 'textDocument/didOpen') { opens++; publish(msg.params.textDocument.uri); }
		else if (msg.method === 'textDocument/didChange') { changes++; publish(msg.params.textDocument.uri); }
		else if (msg.method === 'shutdown') send({id: msg.id, result: null});
		else if (msg.method === 'exit') process.exit(0);
	}
});
`;

let fixtureDir: string;
let serverConfig: LSPServerConfig;

test.before(() => {
	fixtureDir = realpathSync(mkdtempSync(join(tmpdir(), 'nanocoder-lsp-wait-')));
	const script = join(fixtureDir, 'fake-lsp.js');
	writeFileSync(script, FAKE_SERVER);
	writeFileSync(join(fixtureDir, 'bad.fake'), 'const x: number = "nope";\n');
	serverConfig = {
		name: 'fake-lsp',
		command: process.execPath,
		args: [script],
		languages: ['fake'],
	};
});

test.after.always(() => {
	resetSessionCwd();
	rmSync(fixtureDir, {recursive: true, force: true});
});

test.afterEach.always(async () => {
	resetSessionCwd();
	await resetLSPManager();
});

const execute = getDiagnosticsTool.tool.execute as (
	args: {path: string},
	options: unknown,
) => Promise<string | {llmContent: string}>;

function text(result: string | {llmContent: string}): string {
	return typeof result === 'string' ? result : result.llmContent;
}

test.serial(
	'the first diagnostics call after opening waits for the server, and a relative path hits the cache',
	async t => {
		setSessionCwd(fixtureDir);
		const manager = await getLSPManager({rootUri: `file://${fixtureDir}`});
		await manager.initialize({autoDiscover: false, servers: [serverConfig]});

		const first = text(await execute({path: 'bad.fake'}, {}));
		t.regex(first, /ERROR at line 1:7: \[fake\] opens=1 changes=0/);

		// Unchanged document: answered from the cache, without re-sending it.
		const started = Date.now();
		const second = text(await execute({path: 'bad.fake'}, {}));
		t.true(Date.now() - started < 200, 'an unchanged document must not wait');
		t.regex(second, /opens=1 changes=0/);
	},
);

test.serial('an edited document is re-sent and its fresh diagnostics awaited', async t => {
	const manager = new LSPManager({rootUri: `file://${fixtureDir}`});
	await manager.initialize({autoDiscover: false, servers: [serverConfig]});
	const file = join(fixtureDir, 'bad.fake');

	await manager.openDocument(file, 'const a = 1;\n');
	t.is((await manager.getDiagnostics(file))[0]?.message, 'opens=1 changes=0');

	await manager.openDocument(file, 'const a = 2;\n');
	t.is((await manager.getDiagnostics(file))[0]?.message, 'opens=1 changes=1');
	await manager.shutdown();
});

test.serial('relative and absolute paths name the same document', async t => {
	setSessionCwd(fixtureDir);
	const manager = new LSPManager({rootUri: `file://${fixtureDir}`});
	await manager.initialize({autoDiscover: false, servers: [serverConfig]});

	await manager.openDocument('bad.fake');
	const diagnostics = await manager.getDiagnostics(join(fixtureDir, 'bad.fake'));
	t.is(diagnostics.length, 1);
	t.is(manager.getAllDiagnostics()[0]?.uri, `file://${fixtureDir}/bad.fake`);
	await manager.shutdown();
});

test.serial(
	'a server that fails to start is reported with its stderr, not as an unsupported type',
	async t => {
		const manager = await getLSPManager({rootUri: `file://${fixtureDir}`});
		const results = await manager.initialize({
			autoDiscover: false,
			servers: [{...serverConfig, env: {FAKE_LSP_NO_TS: '1'}}],
		});
		t.false(results[0]!.success);

		const result = text(await execute({path: join(fixtureDir, 'bad.fake')}, {}));
		t.regex(result, /fake-lsp" failed to start/);
		t.regex(result, /Could not find a valid TypeScript installation/);
		t.notRegex(result, /No language server available for file type/);
	},
);
