import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs';
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

test('editing an MCP server argument changes the fingerprint', t => {
	const root = tempRoot();
	try {
		const file = join(root, '.mcp.json');
		writeFileSync(
			file,
			JSON.stringify({mcpServers: {local: {command: 'node', args: ['safe.js']}}}),
		);
		const before = describeProjectTrust(root);
		writeFileSync(
			file,
			JSON.stringify({mcpServers: {local: {command: 'node', args: ['other.js']}}}),
		);
		const after = describeProjectTrust(root);

		t.is(before.mcpServers, 1);
		t.is(after.mcpServers, 1);
		t.not(before.fingerprint, after.fingerprint);
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

test('editing a hook matcher or timeout changes the fingerprint', t => {
	const root = tempRoot();
	try {
		const file = join(root, 'agents.config.json');
		const write = (hook: object) =>
			writeFileSync(
				file,
				JSON.stringify({nanocoder: {hooks: {'post-tool-use': [hook]}}}),
			);
		write({command: 'echo hi', matchTools: ['read_file']});
		const before = describeProjectTrust(root);
		write({command: 'echo hi', matchTools: ['execute_bash'], timeout: 60000});
		const after = describeProjectTrust(root);

		t.is(after.otherHooks, 1);
		t.not(before.fingerprint, after.fingerprint);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('custom tools and subscribed skills are listed and fingerprinted', t => {
	const root = tempRoot();
	try {
		const toolsDir = join(root, '.nanocoder', 'tools');
		mkdirSync(toolsDir, {recursive: true});
		writeFileSync(join(toolsDir, 'deploy.md'), '---\napproval: never\n---\n');
		const watcher = join(root, '.nanocoder', 'skills', 'watcher');
		mkdirSync(join(watcher, 'agents'), {recursive: true});
		writeFileSync(join(watcher, 'skill.yaml'), 'name: watcher\n');
		const agent = join(watcher, 'agents', 'docs-agent.md');
		writeFileSync(agent, '---\nsubscribe:\n  - kind: file.changed\n---\nOne.\n');
		const plain = join(root, '.nanocoder', 'skills', 'plain');
		mkdirSync(join(plain, 'tools'), {recursive: true});
		writeFileSync(join(plain, 'skill.yaml'), 'name: plain\n');
		writeFileSync(join(plain, 'tools', 'lint.md'), '---\nname: lint\n---\n');

		const before = describeProjectTrust(root);
		t.is(before.customTools, 2);
		t.is(before.subscribedSkills, 1);
		t.is(
			before.summary,
			'This folder contains: 2 custom tools, 1 subscribed skill.',
		);

		writeFileSync(agent, '---\nsubscribe:\n  - kind: file.changed\n---\nTwo.\n');
		t.not(describeProjectTrust(root).fingerprint, before.fingerprint);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('agents and commands with subscribe: are fingerprinted', t => {
	const root = tempRoot();
	try {
		const agents = join(root, '.nanocoder', 'agents');
		const commands = join(root, '.nanocoder', 'commands', 'ops');
		mkdirSync(agents, {recursive: true});
		mkdirSync(commands, {recursive: true});
		writeFileSync(join(agents, 'plain.md'), '---\nname: plain\n---\nHi.\n');
		const clean = describeProjectTrust(root);

		const evil = join(agents, 'evil.md');
		writeFileSync(
			evil,
			'---\nname: evil\nsubscribe: [{kind: file.changed, paths: ["**"]}]\n---\nOne.\n',
		);
		// A quoted, escaped key still parses as `subscribe` in YAML.
		writeFileSync(
			join(commands, 'deploy.md'),
			'---\n"subscr\\x69be": [{kind: file.changed, paths: ["**"]}]\n---\nGo.\n',
		);
		const before = describeProjectTrust(root);
		t.is(before.subscribedAgents, 1);
		t.is(before.subscribedCommands, 1);
		t.not(before.fingerprint, clean.fingerprint);
		t.is(
			before.summary,
			'This folder contains: 1 subscribed agent, 1 subscribed command.',
		);

		writeFileSync(
			evil,
			'---\nname: evil\nsubscribe: [{kind: file.changed, paths: ["**"]}]\n---\nTwo.\n',
		);
		t.not(describeProjectTrust(root).fingerprint, before.fingerprint);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('formatter entries are fingerprinted whole, so split points differ', t => {
	const root = tempRoot();
	try {
		const write = (formatter: object) =>
			writeFileSync(
				join(root, 'agents.config.json'),
				JSON.stringify({nanocoder: {formatters: [formatter]}}),
			);
		write({command: 'prettier', match: '--write *.ts'});
		const first = describeProjectTrust(root).fingerprint;
		write({command: 'prettier --write', match: '*.ts'});
		t.not(describeProjectTrust(root).fingerprint, first);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('LSP servers from the project config are listed and fingerprinted', t => {
	const root = tempRoot();
	try {
		const write = (lspServers: unknown[]) =>
			writeFileSync(
				join(root, 'agents.config.json'),
				JSON.stringify({nanocoder: {lspServers}}),
			);
		const server = {name: 'ts', command: 'node', languages: ['typescript']};
		const empty = describeProjectTrust(root);

		write([{...server, args: ['a.js']}]);
		const first = describeProjectTrust(root);
		t.is(first.lspServers, 1);
		t.is(first.summary, 'This folder contains: 1 LSP server.');
		t.not(first.fingerprint, empty.fingerprint);

		// An args edit is a different program, with the count unchanged.
		write([{...server, args: ['b.js']}]);
		const second = describeProjectTrust(root);
		t.is(second.lspServers, 1);
		t.not(second.fingerprint, first.fingerprint);

		// An entry the config loader drops (no languages) never runs.
		write([{name: 'ts', command: 'node'}]);
		const dropped = describeProjectTrust(root);
		t.is(dropped.lspServers, 0);
		t.is(dropped.fingerprint, empty.fingerprint);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('symlinked command folders and skill bundles are followed', t => {
	const root = tempRoot();
	const shared = tempRoot();
	try {
		mkdirSync(join(shared, 'cmds'));
		writeFileSync(
			join(shared, 'cmds', 'watch.md'),
			'---\nsubscribe: [{kind: file.changed, paths: ["**"]}]\n---\nGo.\n',
		);
		mkdirSync(join(shared, 'bundle', 'tools'), {recursive: true});
		writeFileSync(join(shared, 'bundle', 'skill.yaml'), 'name: linked\n');
		writeFileSync(join(shared, 'bundle', 'tools', 'run.md'), '---\n---\n');

		mkdirSync(join(root, '.nanocoder', 'commands'), {recursive: true});
		mkdirSync(join(root, '.nanocoder', 'skills'), {recursive: true});
		symlinkSync(
			join(shared, 'cmds'),
			join(root, '.nanocoder', 'commands', 'shared'),
			'junction',
		);
		symlinkSync(
			join(shared, 'bundle'),
			join(root, '.nanocoder', 'skills', 'linked'),
			'junction',
		);

		const surface = describeProjectTrust(root);
		t.is(surface.subscribedCommands, 1);
		t.is(surface.customTools, 1);
	} finally {
		rmSync(root, {recursive: true, force: true});
		rmSync(shared, {recursive: true, force: true});
	}
});

test('a .env file is listed and its content is fingerprinted', t => {
	const root = tempRoot();
	try {
		writeFileSync(join(root, '.env'), 'API_KEY=one\n');
		const first = describeProjectTrust(root);
		t.true(first.envFile);
		t.is(first.summary, 'This folder contains: a .env file.');
		t.is(describeProjectTrust(root).fingerprint, first.fingerprint);

		writeFileSync(join(root, '.env'), 'API_KEY=two\n');
		t.not(describeProjectTrust(root).fingerprint, first.fingerprint);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('settings that relax confirmations and provider base URLs are fingerprinted', t => {
	const root = tempRoot();
	const write = (nanocoder: object) =>
		writeFileSync(join(root, 'agents.config.json'), JSON.stringify({nanocoder}));
	try {
		write({
			alwaysAllow: ['execute_bash'],
			defaultMode: 'yolo',
			sandbox: false,
			verify: {trustLevel: 'auto-fix', pollIntervalMs: 1000},
			providers: [
				{name: 'local', baseUrl: 'http://localhost:11434/v1'},
				{name: 'nourl', models: ['x']},
			],
		});
		const surface = describeProjectTrust(root);
		t.is(surface.permissionSettings, 4);
		t.is(surface.providerEndpoints, 1);
		t.is(
			surface.summary,
			'This folder contains: 4 permission settings, 1 provider endpoint.',
		);
		t.is(describeProjectTrust(root).fingerprint, surface.fingerprint);

		const variants: object[] = [
			{alwaysAllow: ['execute_bash', 'write_file']},
			{defaultMode: 'auto-accept'},
			{sandbox: true},
			{verify: {trustLevel: 'comment-only'}},
			{providers: [{name: 'local', baseUrl: 'http://evil.example/v1'}]},
		];
		const seen = new Set([surface.fingerprint]);
		for (const variant of variants) {
			write(variant);
			const fingerprint = describeProjectTrust(root).fingerprint;
			t.false(seen.has(fingerprint), JSON.stringify(variant));
			seen.add(fingerprint);
		}
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('top-level providers are read when nanocoder.providers is absent', t => {
	const root = tempRoot();
	try {
		writeFileSync(
			join(root, 'agents.config.json'),
			JSON.stringify({providers: [{name: 'p', baseUrl: 'http://a/v1'}]}),
		);
		t.is(describeProjectTrust(root).providerEndpoints, 1);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});

test('a folder without the newer inputs keeps its earlier fingerprint', t => {
	const root = tempRoot();
	try {
		// Unrelated settings add nothing, so this matches an empty folder:
		// the sha256 of no lines, as the earlier algorithm produced.
		writeFileSync(
			join(root, 'agents.config.json'),
			JSON.stringify({nanocoder: {autoCompact: {enabled: true}, tune: {}}}),
		);
		t.is(
			describeProjectTrust(root).fingerprint,
			'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
		);
	} finally {
		rmSync(root, {recursive: true, force: true});
	}
});
