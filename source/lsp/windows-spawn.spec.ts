import {mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import test from 'ava';
import {LSPClient} from './lsp-client';
import {discoverLanguageServers, getKnownServersStatus} from './server-discovery';

// These regressions require real Windows command resolution and .cmd execution.
const windowsTest = process.platform === 'win32' ? test.serial : test.serial.skip;

const fakeServer = String.raw`
if (process.argv.includes('--version')) {
    if (process.argv.length !== 3) process.exit(2);
    console.log('1.0.0');
    process.exit(0);
}
if (process.argv.length !== 3 || process.argv[2] !== '--stdio') process.exit(2);

let buffer = Buffer.alloc(0);
function reply(id, result) {
    const body = Buffer.from(JSON.stringify({jsonrpc: '2.0', id, result}));
    process.stdout.write('Content-Length: ' + body.length + '\r\n\r\n');
    process.stdout.write(body);
}
process.stdin.on('data', chunk => {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
        const headerEnd = buffer.indexOf('\r\n\r\n');
        if (headerEnd < 0) return;
        const match = /Content-Length:\s*(\d+)/i.exec(
            buffer.subarray(0, headerEnd).toString(),
        );
        if (!match) process.exit(3);
        const start = headerEnd + 4;
        const end = start + Number(match[1]);
        if (buffer.length < end) return;
        const message = JSON.parse(buffer.subarray(start, end).toString());
        buffer = buffer.subarray(end);
        if (message.method === 'initialize') {
            reply(message.id, {capabilities: {completionProvider: {}}});
        } else if (message.method === 'shutdown') {
            reply(message.id, null);
        } else if (message.method === 'exit') {
            process.exit(0);
        }
    }
});
process.stdin.on('end', () => process.exit(0));
`;

function createFixture(onPath: boolean) {
    const previousCwd = process.cwd();
    const previousPath = process.env.PATH;
    const previousPathExt = process.env.PATHEXT;
    // Spaces exercise both command-path handling and argument preservation.
    const root = mkdtempSync(join(tmpdir(), 'nanocoder windows lsp '));
    const bin = join(root, 'node_modules', '.bin');
    mkdirSync(bin, {recursive: true});
    writeFileSync(join(root, 'fake-server.cjs'), fakeServer);

    const systemRoot = process.env.SystemRoot || 'C:\\Windows';
    process.env.PATH = [
        ...(onPath ? [bin] : []),
        join(systemRoot, 'System32'),
    ].join(';');
    process.env.PATHEXT = '.COM;.EXE;.BAT;.CMD';
    process.chdir(root);

    return {
        root,
        bin,
        writeShim(name: string, body?: string): string {
            const shim = join(bin, `${name}.cmd`);
            writeFileSync(
                shim,
                body ??
                    `@echo off\r\n"${process.execPath}" "%~dp0..\\..\\fake-server.cjs" %*\r\n`,
            );
            return shim;
        },
        async cleanup(): Promise<void> {
            process.chdir(previousCwd);
            if (previousPath === undefined) delete process.env.PATH;
            else process.env.PATH = previousPath;
            if (previousPathExt === undefined) delete process.env.PATHEXT;
            else process.env.PATHEXT = previousPathExt;
            await rm(root, {recursive: true, force: true, maxRetries: 20, retryDelay: 100});
        },
    };
}

windowsTest('discovery verifies a .cmd language server on PATH', async t => {
    const fixture = createFixture(true);
    try {
        fixture.writeShim('typescript-language-server');
        const status = getKnownServersStatus().find(
            server => server.name === 'typescript-language-server',
        );
        t.true(status?.available);

        const servers = await discoverLanguageServers(fixture.root);
        const server = servers.find(s => s.name === 'typescript-language-server');
        t.is(server?.command, 'typescript-language-server');
        t.deepEqual(server?.args, ['--stdio']);
    } finally {
        await fixture.cleanup();
    }
});

windowsTest('discovery uses a local .cmd shim in a path containing spaces', async t => {
    const fixture = createFixture(false);
    try {
        const shim = fixture.writeShim('typescript-language-server');
        // npm also installs an extensionless POSIX shim; Windows must prefer .cmd.
        writeFileSync(join(fixture.bin, 'typescript-language-server'), '#!/bin/sh\nexit 1\n');

        const servers = await discoverLanguageServers(fixture.root);
        const server = servers.find(s => s.name === 'typescript-language-server');
        t.is(server?.command, shim);
        t.deepEqual(server?.args, ['--stdio']);
    } finally {
        await fixture.cleanup();
    }
});

windowsTest('discovery rejects a .cmd server whose version check fails', async t => {
    const fixture = createFixture(true);
    try {
        fixture.writeShim('typescript-language-server', '@echo off\r\nexit /b 1\r\n');
        t.true(
            getKnownServersStatus().find(s => s.name === 'typescript-language-server')
                ?.available,
        );
        const servers = await discoverLanguageServers(fixture.root);
        t.false(servers.some(s => s.name === 'typescript-language-server'));
    } finally {
        await fixture.cleanup();
    }
});

windowsTest('Windows availability ignores a local POSIX shim without .cmd', async t => {
    const fixture = createFixture(false);
    try {
        writeFileSync(join(fixture.bin, 'typescript-language-server'), '#!/bin/sh\nexit 0\n');
        t.false(
            getKnownServersStatus().find(s => s.name === 'typescript-language-server')
                ?.available,
        );
    } finally {
        await fixture.cleanup();
    }
});

windowsTest('discovery can spawn a .cmd server using LSP verification', async t => {
    const fixture = createFixture(true);
    try {
        // Discovery checks the spawn event, not an initialize handshake.
        fixture.writeShim('pyright-langserver', '@echo off\r\nexit /b 0\r\n');
        const servers = await discoverLanguageServers(fixture.root);
        const server = servers.find(s => s.name === 'pyright');
        t.is(server?.command, 'pyright-langserver');
        t.deepEqual(server?.args, ['--stdio']);
    } finally {
        await fixture.cleanup();
    }
});

windowsTest('LSPClient initializes and shuts down through a .cmd shim', async t => {
    t.timeout(65000);
    const fixture = createFixture(false);
    const client = new LSPClient({
        name: 'fake-windows-server',
        command: fixture.writeShim('typescript-language-server'),
        args: ['--stdio'],
        languages: ['ts'],
        rootUri: pathToFileURL(fixture.root).href,
    });
    // Consume the EventEmitter error event so start() reports failures as rejections.
    client.on('error', () => {});

    try {
        const result = await client.start();
        t.deepEqual(result.capabilities, {completionProvider: {}});
        t.true(client.isReady());
        await client.stop();
        t.false(client.isReady());
    } finally {
        await client.stop();
        await fixture.cleanup();
    }
});
