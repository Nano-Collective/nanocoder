import test from 'ava';
import {TRUST_FINGERPRINT_VERSION} from '@/config/trust/project-trust';
import type {PlainInitResult} from '@/plain/initialize';
import type {LLMClient} from '@/types/core';
import {
	buildHeadlessReviewJson,
	type HeadlessReviewCliDeps,
	type HeadlessReviewOptions,
	runHeadlessReview,
	runHeadlessReviewCli,
	splitHeadlessReviewArgs,
} from './headless-review';
import {
	createScriptedReviewClient,
	findingBlock,
	verdictBlock,
} from './review-client-test-helpers';
import {createReviewFixtureTools, createReviewGitFixture} from './review-test-helpers';

test('splits a tier word from the review target', t => {
	t.deepEqual(splitHeadlessReviewArgs([]), {tier: 'grounded', request: ''});
	t.deepEqual(splitHeadlessReviewArgs(['feature/auth']), {
		tier: 'grounded',
		request: 'feature/auth',
	});
	t.deepEqual(splitHeadlessReviewArgs(['deep', 'last', '2', 'commits']), {
		tier: 'deep',
		request: 'last 2 commits',
	});
	t.deepEqual(splitHeadlessReviewArgs(['quick', '42']), {
		tier: 'quick',
		request: '42',
	});
});

test('headless review writes the report to stdout and progress elsewhere', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/headless']);
	fixture.write(
		'src/file.ts',
		'export function average(total: number, count: number) {\n\treturn total / count;\n}\n',
	);
	fixture.runGit(['add', '--all']);
	fixture.runGit(['commit', '-m', 'add average']);

	const {client} = createScriptedReviewClient(call =>
		call.role === 'finder'
			? {content: findingBlock({file: 'src/file.ts', line: 2})}
			: {content: verdictBlock({})},
	);
	const progress: string[] = [];
	const outcome = await runHeadlessReview({
		args: ['branch', 'feature/headless'],
		client,
		provider: 'review-test',
		model: 'review-test-model',
		tools: createReviewFixtureTools(fixture),
		writeProgress: line => progress.push(line),
	});

	t.is(outcome.exitCode, 0);
	t.true(outcome.stdout.includes('## Grounded review · completed'));
	t.true(outcome.stdout.includes('`src/file.ts:2`'));
	t.false(outcome.stdout.includes('finder: turn'));
	t.true(progress.some(line => line.includes('finder')));
	t.true(progress.some(line => line.startsWith('review: completed')));
});

test('headless JSON keeps the status and findings and stays off the progress stream', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.write('src/file.ts', 'export const value = 2;\n');
	const {client} = createScriptedReviewClient(() => ({content: 'NO FINDINGS'}));
	const progress: string[] = [];
	const outcome = await runHeadlessReview({
		args: ['working', 'tree'],
		client,
		provider: 'review-test',
		model: 'review-test-model',
		outputFormat: 'json',
		tools: createReviewFixtureTools(fixture),
		writeProgress: line => progress.push(line),
	});

	t.is(outcome.exitCode, 0);
	const parsed = JSON.parse(outcome.stdout) as ReturnType<
		typeof buildHeadlessReviewJson
	>;
	t.is(parsed.tier, 'grounded');
	t.is(parsed.status, 'completed');
	t.deepEqual(parsed.findings, []);
	t.false(progress.some(line => line.includes('NO FINDINGS')));
	t.true(outcome.stdout.endsWith('\n'));
});

test('a failed headless review exits non-zero and still prints the report', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/headless-fail']);
	fixture.write('src/file.ts', 'export const value = 2;\n');
	fixture.runGit(['add', '--all']);
	fixture.runGit(['commit', '-m', 'change']);
	const {client} = createScriptedReviewClient(() => {
		throw new Error('connection refused');
	});
	const outcome = await runHeadlessReview({
		args: ['deep', 'branch', 'feature/headless-fail'],
		client,
		provider: 'review-test',
		model: 'review-test-model',
		tools: createReviewFixtureTools(fixture),
		writeProgress: () => {},
	});
	t.is(outcome.exitCode, 1);
	t.true(outcome.stdout.includes('## Deep review · failed'));
	t.false(outcome.stdout.includes('tool: git'));
});

test('an incomplete headless review exits 2 so CI cannot read it as a clean pass', async t => {
	const fixture = createReviewGitFixture();
	t.teardown(fixture.cleanup);
	fixture.runGit(['checkout', '-b', 'feature/headless-partial']);
	fixture.write('src/file.ts', 'export const value = 2;\n');
	fixture.runGit(['add', '--all']);
	fixture.runGit(['commit', '-m', 'change']);
	const {client} = createScriptedReviewClient(() => ({
		content: 'NO FINDINGS',
		finishReason: 'length',
	}));
	const outcome = await runHeadlessReview({
		args: ['branch', 'feature/headless-partial'],
		client,
		provider: 'review-test',
		model: 'review-test-model',
		outputFormat: 'json',
		tools: createReviewFixtureTools(fixture),
		writeProgress: () => {},
	});
	t.is(outcome.exitCode, 2);
	t.is(JSON.parse(outcome.stdout).status, 'incomplete');
});

test('the quick tier prints the one-shot text and does not start a finder', async t => {
	const {client, calls} = createScriptedReviewClient(() => ({
		content: 'Ship it.',
	}));
	const progress: string[] = [];
	const outcome = await runHeadlessReview({
		args: ['quick'],
		client,
		provider: 'review-test',
		model: 'review-test-model',
		writeProgress: line => progress.push(line),
		quickDependencies: {
			execGit: async args => {
				if (args[0] === 'rev-parse') return '';
				return 'diff --git a/file.ts b/file.ts\n+const x = 1;\n';
			},
			getCurrentBranch: async () => 'feature',
			getDefaultBranch: async () => 'main',
		},
	});
	t.is(outcome.exitCode, 0);
	t.true(outcome.stdout.includes('Ship it.'));
	t.is(calls.length, 1);
	t.deepEqual(calls[0]?.tools, {});
	t.true(progress.some(line => line.includes('one-shot')));
});

test('a failed quick review still prints a JSON document', async t => {
	const {client} = createScriptedReviewClient(() => ({content: 'unused'}));
	const outcome = await runHeadlessReview({
		args: ['quick', '42'],
		client,
		provider: 'review-test',
		model: 'review-test-model',
		outputFormat: 'json',
		writeProgress: () => {},
		quickDependencies: {
			execGit: async () => '',
			getCurrentBranch: async () => 'feature',
			getDefaultBranch: async () => 'main',
			isGhAvailable: () => false,
		},
	});
	t.is(outcome.exitCode, 1);
	const parsed = JSON.parse(outcome.stdout) as ReturnType<
		typeof buildHeadlessReviewJson
	>;
	t.is(parsed.tier, 'quick');
	t.is(parsed.status, 'failed');
	t.regex(parsed.message ?? '', /gh CLI/);
});

function cliDeps(
	overrides: Partial<HeadlessReviewCliDeps> = {},
): Partial<HeadlessReviewCliDeps> {
	const client = {
		getProviderConfig: () => ({
			name: 'review-test',
			type: 'openai-compatible',
			models: ['review-test-model'],
			config: {},
			tune: {enabled: true, toolMode: 'xml'},
		}),
	} as unknown as LLMClient;
	return {
		initializePlain: async () =>
			({
				client,
				provider: 'review-test',
				model: 'review-test-model',
			}) as unknown as PlainInitResult,
		runHeadlessReview: async () => ({exitCode: 0, stdout: 'report\n'}),
		loadPreferences: () => ({trustedDirectories: []}),
		savePreferences: () => {},
		getAppConfig: () => ({}),
		getShutdownManager: () => ({register: () => {}, unregister: () => {}}),
		writeError: () => {},
		writeStdout: async () => {},
		...overrides,
	};
}

const TRUST_BYPASS_WORDING =
	'Pass --trust-directory to bypass the disclaimer for this run only, or set NANOCODER_TRUST_DIRECTORY=1 to trust this directory permanently.';

test.serial('the CLI review refuses an untrusted directory before provider setup', async t => {
	delete process.env.NANOCODER_TRUST_DIRECTORY;
	let initialized = false;
	const errors: string[] = [];
	const outcome = await runHeadlessReviewCli({
		args: ['deep', 'main'],
		trustDirectory: false,
		outputFormat: 'json',
		deps: cliDeps({
			initializePlain: async () => {
				initialized = true;
				throw new Error('must not initialize');
			},
			writeError: line => errors.push(line),
		}),
	});
	t.is(outcome.exitCode, 1);
	t.false(initialized);
	const parsed = JSON.parse(outcome.stdout) as ReturnType<
		typeof buildHeadlessReviewJson
	>;
	t.is(parsed.tier, 'deep');
	t.is(parsed.status, 'failed');
	const expected = `Directory ${process.cwd()} is not trusted. ${TRUST_BYPASS_WORDING}`;
	t.is(parsed.message, expected);
	t.deepEqual(errors, [expected]);
});

for (const {name, entry, reason} of [
	{
		name: 'a path-only entry saved before fingerprints',
		entry: process.cwd(),
		reason: 'needs re-approval after the upgrade',
	},
	{
		name: 'an entry whose fingerprint no longer matches',
		entry: {
			path: process.cwd(),
			fingerprint: 'stale-fingerprint',
			fingerprintVersion: TRUST_FINGERPRINT_VERSION,
		},
		reason: 'changed since you trusted it',
	},
]) {
	test.serial(`the CLI review says why it refuses ${name}`, async t => {
		delete process.env.NANOCODER_TRUST_DIRECTORY;
		const errors: string[] = [];
		const outcome = await runHeadlessReviewCli({
			args: ['main'],
			trustDirectory: false,
			outputFormat: 'json',
			deps: cliDeps({
				loadPreferences: () => ({trustedDirectories: [entry]}),
				writeError: line => errors.push(line),
			}),
		});
		t.is(outcome.exitCode, 1);
		const parsed = JSON.parse(outcome.stdout) as ReturnType<
			typeof buildHeadlessReviewJson
		>;
		const expected = `Directory ${process.cwd()} ${reason}. ${TRUST_BYPASS_WORDING}`;
		t.is(parsed.message, expected);
		t.deepEqual(errors, [expected]);
	});
}

test.serial('--trust-directory runs the review with the resolved tune settings', async t => {
	let received: HeadlessReviewOptions | undefined;
	const outcome = await runHeadlessReviewCli({
		args: ['main'],
		cliModel: 'review-test-model',
		trustDirectory: true,
		outputFormat: 'text',
		deps: cliDeps({
			runHeadlessReview: async options => {
				received = options;
				return {exitCode: 0, stdout: 'report\n'};
			},
		}),
	});
	t.deepEqual(outcome, {exitCode: 0, stdout: 'report\n'});
	t.deepEqual(received?.args, ['main']);
	t.is(received?.model, 'review-test-model');
	t.is(received?.tune?.toolMode, 'xml');
});

test.serial('a provider setup failure becomes a failed JSON document', async t => {
	const outcome = await runHeadlessReviewCli({
		args: ['main'],
		trustDirectory: true,
		outputFormat: 'json',
		deps: cliDeps({
			initializePlain: async () => {
				throw new Error('No providers configured');
			},
		}),
	});
	t.is(outcome.exitCode, 1);
	const parsed = JSON.parse(outcome.stdout) as ReturnType<
		typeof buildHeadlessReviewJson
	>;
	t.is(parsed.status, 'failed');
	t.regex(parsed.message ?? '', /No providers configured/);
});

test.serial('a shutdown during the review waits for the cancelled report', async t => {
	let shutdownHandler: (() => Promise<void>) | undefined;
	let unregistered = false;
	const written: string[] = [];
	const run = runHeadlessReviewCli({
		args: ['main'],
		trustDirectory: true,
		outputFormat: 'text',
		deps: cliDeps({
			getShutdownManager: () => ({
				register: entry => {
					shutdownHandler = entry.handler;
				},
				unregister: () => {
					unregistered = true;
				},
			}),
			runHeadlessReview: async options => {
				await new Promise(resolve =>
					options.signal?.addEventListener('abort', resolve),
				);
				return {exitCode: 2, stdout: 'partial report\n'};
			},
			writeStdout: async text => {
				written.push(text);
			},
		}),
	});
	await new Promise(resolve => setImmediate(resolve));
	if (!shutdownHandler) return t.fail('no shutdown handler registered');
	await shutdownHandler();
	t.deepEqual(written, ['partial report\n']);
	t.deepEqual(await run, {exitCode: 2, stdout: 'partial report\n'});
	t.true(unregistered);
});
