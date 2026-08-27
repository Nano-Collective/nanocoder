import {mkdirSync, writeFileSync} from 'node:fs';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'ava';
import {clearAppConfig} from '@/config/index';
import type {LLMClient, Message} from '@/types/core';
import {maybeGenerateTitle} from './maybe-generate-title.js';
import {SessionManager} from './session-manager.js';

console.log('\nmaybe-generate-title.spec.ts');

// getAppConfig() reads from disk, so pin it or these tests inherit whatever
// the developer has configured locally.
const testConfigDir = join(tmpdir(), `nanocoder-title-orch-cfg-${Date.now()}`);
mkdirSync(testConfigDir, {recursive: true});
process.env.NANOCODER_CONFIG_DIR = testConfigDir;
process.chdir(testConfigDir);

// Session config is read from nanocoder-preferences.json under a `nanocoder`
// key, not from agents.config.json.
function writeSessionConfig(sessions: Record<string, unknown>): void {
	writeFileSync(
		join(testConfigDir, 'nanocoder-preferences.json'),
		JSON.stringify({nanocoder: {sessions}}),
	);
	clearAppConfig();
}

let testDir: string;
let manager: SessionManager;

test.beforeEach(async () => {
	writeSessionConfig({});
	testDir = await mkdtemp(join(tmpdir(), 'title-orch-test-'));
	manager = new SessionManager(join(testDir, 'sessions'));
	await manager.initialize();
});

test.afterEach(async () => {
	if (testDir) await rm(testDir, {recursive: true, force: true});
});

function client(content: string, onChat?: () => void): LLMClient {
	return {
		getCurrentModel: () => 'fake',
		setModel: () => {},
		getContextSize: () => 8192,
		getAvailableModels: async () => ['fake'],
		getProviderConfig: () => ({name: 'fake'}),
		chat: async () => {
			onChat?.();
			return {choices: [{message: {role: 'assistant', content}}]};
		},
		clearContext: async () => {},
		getTimeout: () => undefined,
	} as unknown as LLMClient;
}

const turn: Message[] = [
	{role: 'user', content: 'fix this'},
	{
		role: 'assistant',
		content: 'Done.',
		tool_calls: [
			{id: '1', function: {name: 'read_file', arguments: {path: 'a.ts'}}},
		],
	},
];

const greetingTurn: Message[] = [
	{role: 'user', content: 'hi'},
	{role: 'assistant', content: 'Hello! How can I help?'},
];

async function seed(title: string, extra: Record<string, unknown> = {}) {
	const session = await manager.createSession({
		title,
		messageCount: 2,
		provider: 'fake',
		model: 'fake',
		workingDirectory: '/tmp',
		messages: turn,
	});
	if (Object.keys(extra).length > 0) {
		await manager.saveSession({...session, ...extra});
	}
	return session;
}

test('generates and persists a title for a weak session', async t => {
	const session = await seed('fix this');
	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: client('Fix Login Redirect'),
		manager,
	});

	const reloaded = await manager.readSession(session.id);
	t.is(reloaded?.title, 'Fix Login Redirect');
	t.true(reloaded?.titleGenerated);
	// Must not masquerade as a user rename, or the user's own rename becomes
	// indistinguishable from an AI one.
	t.not(reloaded?.titleManuallySet, true);
});

test('does not title a greeting until a second user turn adds context', async t => {
	const session = await manager.createSession({
		title: 'hi',
		messageCount: 2,
		provider: 'fake',
		model: 'fake',
		workingDirectory: '/tmp',
		messages: greetingTurn,
	});
	let called = false;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: greetingTurn,
		client: client('Should Not Be Used', () => {
			called = true;
		}),
		manager,
	});

	const stillGreeting = await manager.readSession(session.id);
	t.is(stillGreeting?.title, 'hi');
	t.not(stillGreeting?.titleGenerated, true);
	t.false(called);

	await manager.saveSession({
		...stillGreeting!,
		messages: [
			...greetingTurn,
			{role: 'user', content: 'summarize the README'},
			{role: 'assistant', content: 'The README describes the project.'},
		],
		messageCount: 4,
	});

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: [
			...greetingTurn,
			{role: 'user', content: 'summarize the README'},
			{role: 'assistant', content: 'The README describes the project.'},
		],
		client: client('README Overview'),
		manager,
	});

	const titled = await manager.readSession(session.id);
	t.is(titled?.title, 'README Overview');
	t.true(titled?.titleGenerated);
});

test('never overwrites a manually renamed title', async t => {
	const session = await seed('fix this');
	await manager.renameSession(session.id, 'My Own Name');

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: client('Fix Login Redirect'),
		manager,
	});

	const reloaded = await manager.readSession(session.id);
	t.is(reloaded?.title, 'My Own Name');
});

test('does not call the model at all when the title is already strong', async t => {
	const strong = 'refactor session-manager to use atomic writes everywhere';
	const session = await seed(strong);
	let called = false;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: [{role: 'user', content: strong}, turn[1]],
		client: client('Something Else', () => {
			called = true;
		}),
		manager,
	});

	t.false(called);
	t.is((await manager.readSession(session.id))?.title, strong);
});

test('does not re-generate once titleGenerated is set', async t => {
	const session = await seed('fix this', {
		title: 'Already Named',
		titleGenerated: true,
	});
	let called = false;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: client('Something Else', () => {
			called = true;
		}),
		manager,
	});

	t.false(called);
	t.is((await manager.readSession(session.id))?.title, 'Already Named');
});

test('does not fire before an assistant message exists', async t => {
	const session = await seed('fix this');
	let called = false;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: [{role: 'user', content: 'fix this'}],
		client: client('Too Early', () => {
			called = true;
		}),
		manager,
	});

	t.false(called);
});

test('leaves the title alone when the model returns nothing usable', async t => {
	const session = await seed('fix this');
	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: client('   '),
		manager,
	});

	const reloaded = await manager.readSession(session.id);
	t.is(reloaded?.title, 'fix this');
	t.not(reloaded?.titleGenerated, true);
});

test('reports the title through onTitle', async t => {
	const session = await seed('fix this');
	let reported: string | null = null;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: client('Fix Login Redirect'),
		manager,
		onTitle: title => {
			reported = title;
		},
	});

	t.is(reported, 'Fix Login Redirect');
});

test('does not report through onTitle when nothing was persisted', async t => {
	const session = await seed('fix this');
	let reported: string | null = null;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: client('   '),
		manager,
		onTitle: title => {
			reported = title;
		},
	});

	t.is(reported, null);
});

test('smartTitles false disables generation entirely', async t => {
	writeSessionConfig({smartTitles: false});
	const session = await seed('fix this');
	let called = false;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: client('Fix Login Redirect', () => {
			called = true;
		}),
		manager,
	});

	t.false(called);
	t.is((await manager.readSession(session.id))?.title, 'fix this');
});

test('a missing session is a no-op, not a throw', async t => {
	await t.notThrowsAsync(
		maybeGenerateTitle({
			sessionId: '00000000-0000-4000-8000-000000000000',
			messages: turn,
			client: client('Fix Login Redirect'),
			manager,
		}),
	);
});

test('a rename that lands mid-flight still wins', async t => {
	const session = await seed('fix this');

	// Rename while the model call is in flight. Without the re-read before
	// write, the generator would clobber the user's choice.
	const racingClient = {
		...client('Fix Login Redirect'),
		chat: async () => {
			await manager.renameSession(session.id, 'Renamed Mid Flight');
			return {
				choices: [
					{message: {role: 'assistant', content: 'Fix Login Redirect'}},
				],
			};
		},
	} as unknown as LLMClient;

	await maybeGenerateTitle({
		sessionId: session.id,
		messages: turn,
		client: racingClient,
		manager,
	});

	const reloaded = await manager.readSession(session.id);
	t.is(reloaded?.title, 'Renamed Mid Flight');
	t.not(reloaded?.titleGenerated, true);
});

test('never rejects, even when the session store throws', async t => {
	// Both call sites invoke this as a bare `void` with no .catch(), so a
	// rejection here becomes an unhandled rejection and takes the process down.
	// An uninitialised SessionManager does exactly this: readSession builds a
	// path from an undefined directory and throws TypeError.
	const brokenManager = {
		readSession: async () => {
			throw new TypeError('paths[0] must be a string');
		},
		saveSession: async () => {},
	} as unknown as SessionManager;

	await t.notThrowsAsync(
		maybeGenerateTitle({
			sessionId: '00000000-0000-4000-8000-000000000000',
			messages: turn,
			client: client('Fix Login Redirect'),
			manager: brokenManager,
		}),
	);
});
