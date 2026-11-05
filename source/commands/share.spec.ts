import {promises as fs} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'ava';
import type React from 'react';
import {getCommandHelpDetails} from '@/commands/help-utils';
import {getAppConfig} from '@/config/index';
import {
	resetSessionCwd,
	setProjectRoot,
	setSessionCwd,
} from '@/services/session-cwd';
import type {Message} from '@/types/index';
import {lazyCommands} from './lazy-registry';
import {shareCommand} from './share';

console.log('\nshare.spec.ts');

const SECRET = 'sk-abcdefghijklmnopqrstuvwx';

const metadata = {
	provider: 'test-provider',
	model: 'test-model',
	tokens: 100,
	getMessageTokens: () => 0,
};

const conversation: Message[] = [
	{role: 'system', content: 'System prompt'},
	{role: 'user', content: 'Fix the login bug'},
	{
		role: 'assistant',
		content: 'Looking.',
		tool_calls: [
			{id: 'c1', function: {name: 'read_file', arguments: {path: 'login.ts'}}},
		],
	},
	{role: 'tool', tool_call_id: 'c1', name: 'read_file', content: 'export {}'},
	{role: 'assistant', content: `Found it. Your key ${SECRET} was exposed.`},
];

let root = '';

test.beforeEach(async () => {
	root = await fs.realpath(
		await fs.mkdtemp(path.join(os.tmpdir(), 'nanocoder-share-')),
	);
	setProjectRoot(root);
	setSessionCwd(root);
});

test.afterEach.always(async () => {
	resetSessionCwd();
	await fs.rm(root, {recursive: true, force: true});
});

async function share(args: string[], messages: Message[] = conversation) {
	const result = (await shareCommand.handler(args, messages, metadata)) as
		| React.ReactElement<{message: string}>
		| undefined;
	return {
		result,
		message: result?.props.message ?? '',
		files: (await fs.readdir(root)).sort(),
	};
}

test('share is registered and documented in /help', t => {
	const entry = lazyCommands.find(command => command.name === 'share');
	t.is(entry?.description, shareCommand.description);
	const help = getCommandHelpDetails(shareCommand);
	t.is(help.category, 'Session & Workflow');
	t.is(help.usage, '/share [--json] [--no-redact] [filename]');
});

test('writes a redacted HTML page under a generated name', async t => {
	const {message, files} = await share([]);

	t.is(files.length, 1);
	t.regex(files[0] ?? '', /^fix-the-login-bug-\d{4}-\d{2}-\d{2}\.html$/);
	const html = await fs.readFile(path.join(root, files[0] ?? ''), 'utf8');
	t.true(html.startsWith('<!doctype html>'));
	t.true(html.includes('Fix the login bug'));
	t.false(html.includes(SECRET));
	t.false(html.includes('System prompt'));
	t.true(message.startsWith(`Wrote the session page to ${files[0]}\n`));
	t.true(message.includes('Redacted 1 secret.'));
});

test('a generated name never overwrites an earlier share', async t => {
	await share([]);
	const {files} = await share([]);
	t.is(files.length, 2);
	t.true(files.some(file => /-2\.html$/.test(file)));
});

test('a generated name is built from the redacted prompt', async t => {
	const {files} = await share(
		[],
		[{role: 'user', content: 'use sk-aaaaaaaaaaaaaaaaaaaaaaaa now'}],
	);
	t.regex(files[0] ?? '', /^use-redacted-now-/);
});

test('API keys written into the provider config are redacted', async t => {
	const config = getAppConfig();
	const original = config.providers;
	t.teardown(() => {
		config.providers = original;
	});
	config.providers = [
		{name: 'local', models: ['m'], apiKey: 'plain-config-key-1234'},
	];

	const {message} = await share(
		['out.html'],
		[{role: 'user', content: 'apiKey is plain-config-key-1234'}],
	);

	const html = await fs.readFile(path.join(root, 'out.html'), 'utf8');
	t.false(html.includes('plain-config-key-1234'));
	t.true(html.includes('apiKey is [REDACTED]'));
	t.true(message.includes('Redacted 1 secret.'));
});

test('--json writes the deterministic payload', async t => {
	const {message, files} = await share(['--json']);

	t.regex(files[0] ?? '', /\.json$/);
	const raw = await fs.readFile(path.join(root, files[0] ?? ''), 'utf8');
	const payload = JSON.parse(raw);
	t.is(payload.format, 'nanocoder-share');
	t.true(payload.redacted);
	t.is(payload.messages.length, 4);
	t.false(raw.includes(SECRET));
	t.true(message.startsWith(`Wrote the session JSON to ${files[0]}\n`));
	t.false(message.includes('browser'));

	await share(['--json']);
	const second = (await fs.readdir(root)).find(file => file.endsWith('-2.json'));
	t.is(await fs.readFile(path.join(root, second ?? ''), 'utf8'), raw);
});

test('a .json filename selects JSON', async t => {
	await share(['run.json']);
	const raw = await fs.readFile(path.join(root, 'run.json'), 'utf8');
	t.is(JSON.parse(raw).format, 'nanocoder-share');
});

test('a typed filename is written where asked and overwritten', async t => {
	await fs.mkdir(path.join(root, 'notes'));
	await fs.writeFile(path.join(root, 'notes', 'session.html'), 'old');

	const {message} = await share(['notes/session.html']);

	const html = await fs.readFile(path.join(root, 'notes', 'session.html'), 'utf8');
	t.true(html.startsWith('<!doctype html>'));
	t.true(message.startsWith('Wrote the session page to notes/session.html\n'));
});

test('--no-redact keeps secrets and warns', async t => {
	const {result, message} = await share(['--no-redact', 'raw.html']);

	const html = await fs.readFile(path.join(root, 'raw.html'), 'utf8');
	t.true(html.includes(SECRET));
	t.true(html.includes('secrets NOT redacted'));
	t.is((result?.type as {name?: string}).name, 'WarningMessage');
	t.true(message.includes('Secrets were NOT redacted'));
});

test('paths outside the project are refused', async t => {
	for (const [target, reason] of [
		['../outside.html', "'..' segments are not allowed"],
		['~/outside.html', "'~' is not expanded"],
		[path.join(os.tmpdir(), 'outside.html'), 'outside the project directory'],
	] as const) {
		const {message, files} = await share([target]);
		t.true(message.startsWith('Invalid share path: '), target);
		t.true(message.includes(reason), target);
		t.deepEqual(files, [], target);
	}
});

test('a missing parent directory is reported', async t => {
	const {message} = await share(['missing/dir/out.html']);
	t.is(
		message,
		`Failed to share the session: Parent directory does not exist: ${path.join(root, 'missing', 'dir')}`,
	);
});

test('bad arguments are rejected before anything is written', async t => {
	const unknown = await share(['--open']);
	t.is(
		unknown.message,
		'Unknown option --open. Usage: /share [--json] [--no-redact] [filename]',
	);
	const singleDash = await share(['-json']);
	t.is(
		singleDash.message,
		'Unknown option -json. Usage: /share [--json] [--no-redact] [filename]',
	);
	const twoNames = await share(['a.html', 'b.html']);
	t.true(twoNames.message.startsWith('Give at most one filename.'));
	t.deepEqual(twoNames.files, []);
});

test('an empty session has nothing to share', async t => {
	const {message, files} = await share([], [
		{role: 'system', content: 'System prompt'},
		{role: 'assistant', content: ''},
	]);
	t.is(message, 'Nothing to share yet: the session has no messages.');
	t.deepEqual(files, []);
});
