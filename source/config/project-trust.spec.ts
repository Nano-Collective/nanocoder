import {mkdtempSync, mkdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {describeProjectTrust} from './project-trust';

function tempRoot(): string {
	return mkdtempSync(join(tmpdir(), 'project-trust-'));
}

test('an empty folder runs nothing and has a stable fingerprint', t => {
	const root = tempRoot();
	try {
		const first = describeProjectTrust(root);
		const second = describeProjectTrust(root);
		t.is(first.plugins, 0);
		t.is(first.sessionStartHooks, 0);
		t.is(first.otherHooks, 0);
		t.is(first.mcpServers, 0);
		t.is(first.formatters, 0);
		t.is(first.summary, null);
		t.is(first.fingerprint, second.fingerprint);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('plugins, hooks, formatters, and MCP servers are listed', t => {
	const root = tempRoot();
	try {
		const pluginDir = join(root, '.nanocoder', 'plugins');
		mkdirSync(pluginDir, {recursive: true});
		writeFileSync(join(pluginDir, 'b.mjs'), 'export default {name:"b"}\n');
		writeFileSync(join(pluginDir, 'a.mjs'), 'export default {name:"a"}\n');
		writeFileSync(join(pluginDir, 'skip.js'), 'nope');
		writeFileSync(
			join(root, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					hooks: {
						'session-start': [{command: 'echo start'}],
						'pre-tool-use': [{command: 'echo before'}],
					},
					formatters: [{match: '**/*.ts', command: 'biome check'}],
				},
			}),
		);
		writeFileSync(
			join(root, '.mcp.json'),
			JSON.stringify({
				mcpServers: {
					beta: {command: 'server-b'},
					alpha: {command: 'server-a'},
				},
			}),
		);

		const surface = describeProjectTrust(root);
		t.is(surface.plugins, 2);
		t.is(surface.sessionStartHooks, 1);
		t.is(surface.otherHooks, 1);
		t.is(surface.formatters, 1);
		t.is(surface.mcpServers, 2);
		t.is(
			surface.summary,
			'This folder contains: 2 plugins, 1 session-start hook, 1 other hook, 2 MCP servers, 1 formatter.',
		);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('editing a plugin changes the fingerprint without changing the count', t => {
	const root = tempRoot();
	try {
		const pluginDir = join(root, '.nanocoder', 'plugins');
		mkdirSync(pluginDir, {recursive: true});
		const plugin = join(pluginDir, 'pulled.mjs');
		writeFileSync(plugin, 'export default {name:"one"}\n');
		const before = describeProjectTrust(root);

		writeFileSync(plugin, 'export default {name:"two"}\n');
		const after = describeProjectTrust(root);

		t.is(before.plugins, 1);
		t.is(after.plugins, 1);
		t.not(before.fingerprint, after.fingerprint);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
