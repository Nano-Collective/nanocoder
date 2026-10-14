import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'ava';
import {
	type Assertion,
	checkAssertions,
	type Fixture,
	hashTree,
	iqr,
	type JsonReport,
	loadFixtures,
	median,
	parseJsonReport,
	quantile,
	runOnce,
	summarize,
	type TaskRun,
} from './harness';

console.log('\nbenchmarks/agent/harness.spec.ts');

const fixturesDir = path.join(
	path.dirname(fileURLToPath(import.meta.url)),
	'fixtures',
);

let tempRoot: string;

test.beforeEach(async () => {
	tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-eval-spec-'));
});

test.afterEach.always(async () => {
	if (tempRoot) await fs.rm(tempRoot, {recursive: true, force: true});
});

const report = (overrides: Partial<JsonReport> = {}): JsonReport => ({
	kind: 'success',
	exitCode: 0,
	finalText: '',
	steps: 1,
	...overrides,
});

// ============================================================================
// Statistics
// ============================================================================

test('median of an odd and an even sample', t => {
	t.is(median([5, 1, 3]), 3);
	t.is(median([1, 2, 3, 4]), 2.5);
});

test('iqr spans the middle half and is zero for identical runs', t => {
	t.is(iqr([1, 2, 3, 4, 5]), 2);
	t.is(iqr([7, 7, 7, 7, 7]), 0);
});

test('quantile interpolates and reports NaN for no runs', t => {
	t.is(quantile([10, 20], 0.5), 15);
	t.true(Number.isNaN(quantile([], 0.5)));
	t.true(Number.isNaN(iqr([])));
});

// ============================================================================
// Report parsing
// ============================================================================

test('parseJsonReport reads the report a --json run emits', t => {
	const parsed = parseJsonReport(
		JSON.stringify({
			kind: 'success',
			exitCode: 0,
			finalText: 'done',
			steps: 4,
			toolCalls: [],
			usage: {inputTokens: 100, outputTokens: 20, totalTokens: 120},
		}),
	);

	t.is(parsed.steps, 4);
	t.is(parsed.finalText, 'done');
	t.is(parsed.usage?.totalTokens, 120);
});

test('parseJsonReport recovers a report printed alongside a warning', t => {
	const parsed = parseJsonReport(
		`warning: slow provider\n{"kind":"success","exitCode":0,"steps":2}\n`,
	);
	t.is(parsed.steps, 2);
});

test('parseJsonReport rejects a report with no steps field', t => {
	// A CLI predating the steps field must be reported as unmeasurable rather
	// than silently counted as zero steps.
	const error = t.throws(() =>
		parseJsonReport('{"kind":"success","exitCode":0}'),
	);
	t.regex(String(error?.message), /no numeric steps field/);
});

test('parseJsonReport rejects output holding no report at all', t => {
	t.throws(() => parseJsonReport('command not found'), {
		message: /no JSON report found/,
	});
});

// ============================================================================
// Fixtures
// ============================================================================

test('loadFixtures reads every vendored task with its assertions', async t => {
	const fixtures = await loadFixtures(fixturesDir);

	// A lower bound, not an exact count: the README invites contributors to
	// add fixtures, and this must not force a test edit every time one lands.
	t.true(fixtures.length >= 6, 'at least the six fixtures vendored today');
	for (const fixture of fixtures) {
		t.truthy(fixture.prompt, `${fixture.name} has a prompt`);
		t.true(
			fixture.assertions.length > 0,
			`${fixture.name} has at least one assertion`,
		);
		t.not(fixture.category, 'uncategorized', `${fixture.name} is categorised`);
	}

	const categories = new Set(fixtures.map(fixture => fixture.category));
	// The suite has to span more than one kind of work to be worth a baseline.
	t.true(categories.size >= 3);
});

test('hashTree changes when a fixture file changes', async t => {
	await fs.writeFile(path.join(tempRoot, 'a.txt'), 'one');
	const before = await hashTree(tempRoot);

	await fs.writeFile(path.join(tempRoot, 'a.txt'), 'two');
	const after = await hashTree(tempRoot);

	t.not(before, after);
	t.is(before.length, 12);
});

// ============================================================================
// Assertions
// ============================================================================

const unchanged = {before: 'same', after: 'same'};

async function check(
	workspace: string,
	assertions: Assertion[],
	overrides: Partial<JsonReport> = {},
	tree = unchanged,
): Promise<string | null> {
	return checkAssertions(workspace, assertions, report(overrides), tree);
}

test('file-contains passes on a match and reports a miss', async t => {
	await fs.writeFile(path.join(tempRoot, 'config.js'), 'TIMEOUT = 5000');

	t.is(
		await check(tempRoot, [
			{kind: 'file-contains', path: 'config.js', text: '5000'},
		]),
		null,
	);
	t.regex(
		String(
			await check(tempRoot, [
				{kind: 'file-contains', path: 'config.js', text: '9000'},
			]),
		),
		/does not contain/,
	);
});

test('file-not-contains catches leftover content', async t => {
	await fs.writeFile(path.join(tempRoot, 'config.js'), 'TIMEOUT = 3000');

	t.regex(
		String(
			await check(tempRoot, [
				{kind: 'file-not-contains', path: 'config.js', text: '3000'},
			]),
		),
		/still contains/,
	);
});

test('a missing file fails rather than throwing', async t => {
	t.regex(
		String(
			await check(tempRoot, [
				{kind: 'file-contains', path: 'nope.js', text: 'x'},
			]),
		),
		/is missing/,
	);
});

test('final-text-matches is case-insensitive', async t => {
	t.is(
		await check(
			tempRoot,
			[{kind: 'final-text-matches', pattern: 'src/billing/quota\\.js'}],
			{finalText: 'It lives in SRC/BILLING/QUOTA.JS'},
		),
		null,
	);
	t.regex(
		String(
			await check(tempRoot, [
				{kind: 'final-text-matches', pattern: 'quota'},
			]),
		),
		/does not match/,
	);
});

test('final-text-not-matches catches a distractor name the model should have left out', async t => {
	t.is(
		await check(
			tempRoot,
			[{kind: 'final-text-not-matches', pattern: 'formatAddress'}],
			{finalText: 'sendEmail, sendWebhook, sendSlackMessage'},
		),
		null,
	);
	t.regex(
		String(
			await check(
				tempRoot,
				[{kind: 'final-text-not-matches', pattern: 'formatAddress'}],
				{finalText: 'sendEmail, formatAddress'},
			),
		),
		/unexpectedly matches/,
	);
});

test('files-unchanged fails when a read-only task wrote something', async t => {
	t.is(await check(tempRoot, [{kind: 'files-unchanged'}]), null);
	t.regex(
		String(
			await check(tempRoot, [{kind: 'files-unchanged'}], {}, {
				before: 'aaa',
				after: 'bbb',
			}),
		),
		/files changed/,
	);
});

test('unknown assertion kinds fail instead of silently passing', async t => {
	t.regex(
		String(await check(tempRoot, [{kind: 'file-contians'} as unknown as Assertion])),
		/unknown assertion kind/,
	);
});

test('command passes on exit 0 and fails otherwise', async t => {
	await fs.writeFile(
		path.join(tempRoot, 'ok.js'),
		'process.stdout.write("fine")',
	);
	await fs.writeFile(path.join(tempRoot, 'bad.js'), 'process.exit(3)');

	t.is(
		await check(tempRoot, [
			{kind: 'command', command: 'node', args: ['ok.js']},
		]),
		null,
	);
	t.regex(
		String(
			await check(tempRoot, [
				{kind: 'command', command: 'node', args: ['bad.js']},
			]),
		),
		/failed:/,
	);
});

// ============================================================================
// runOnce, driven by a stub CLI instead of a model
// ============================================================================

/** Write a stand-in for `dist/cli.js` that behaves however the test needs. */
async function stubCli(body: string): Promise<string> {
	const cliPath = path.join(tempRoot, 'stub-cli.js');
	await fs.writeFile(cliPath, body);
	return cliPath;
}

async function fixture(
	assertions: Assertion[],
	files: Record<string, string> = {'src/config.js': 'TIMEOUT = 3000\n'},
): Promise<Fixture> {
	const dir = path.join(tempRoot, 'fixture');
	for (const [relative, content] of Object.entries(files)) {
		const target = path.join(dir, relative);
		await fs.mkdir(path.dirname(target), {recursive: true});
		await fs.writeFile(target, content);
	}
	return {
		name: 'stub-task',
		dir,
		category: 'single-file-edit',
		prompt: 'set the timeout to 5000',
		assertions,
	};
}

test('runOnce passes and records the reported steps and tokens', async t => {
	const cliPath = await stubCli(`
		import {writeFileSync} from 'node:fs';
		writeFileSync('src/config.js', 'TIMEOUT = 5000\\n');
		process.stdout.write(JSON.stringify({
			kind: 'success', exitCode: 0, finalText: 'done', steps: 7,
			usage: {inputTokens: 900, outputTokens: 100, totalTokens: 1000},
		}));
	`);

	const run = await runOnce({
		cliPath,
		fixture: await fixture([
			{kind: 'file-contains', path: 'src/config.js', text: '5000'},
		]),
		workspaceRoot: tempRoot,
	});

	t.true(run.pass);
	t.is(run.failure, undefined);
	t.is(run.steps, 7);
	t.is(run.totalTokens, 1000);
	t.is(run.costUsd, null, 'no pricing lookup means no cost, not zero cost');
	t.true(run.durationMs >= 0);
});

test.serial('runOnce isolates user config and carries over only providers', async t => {
	const sourceConfigDir = path.join(tempRoot, 'user-config');
	await fs.mkdir(sourceConfigDir, {recursive: true});
	const providers = [
		{
			name: 'Ollama',
			models: ['qwen2.5:1.5b'],
			baseUrl: 'http://localhost:11434/v1',
			apiKey: '${OLLAMA_API_KEY}',
		},
		{
			name: 'PrivateProvider',
			models: ['private-model'],
			apiKey: 'private-key',
		},
	];
	const environmentProviders = [
		{
			name: 'Ollama',
			models: ['env-model'],
			baseUrl: 'http://localhost:11435/v1',
			apiKey: '${OLLAMA_ENV_API_KEY}',
		},
		{name: 'EnvironmentProvider', models: ['private-env-model']},
	];
	const fileEnvironmentProviders = [
		{
			name: 'Ollama',
			models: ['file-env-model'],
			baseUrl: 'http://localhost:11436/v1',
			apiKey: '${OLLAMA_FILE_API_KEY}',
		},
		{name: 'PrivateFileProvider', models: ['private-file-model']},
	];
	const userConfig = {
		nanocoder: {
			providers,
			hooks: {'session-start': [{command: 'touch private-hook-marker'}]},
			systemPrompt: {content: 'private user prompt'},
			formatters: [{command: 'private formatter', match: ['**/*']}],
			mcpServers: [{name: 'private-server', command: 'private-mcp'}],
		},
	};
	const userConfigContents = JSON.stringify(userConfig, null, 2);
	const preferencesPath = path.join(
		sourceConfigDir,
		'nanocoder-preferences.json',
	);
	const providersFilePath = path.join(sourceConfigDir, 'private-providers.json');
	const preferencesContents = JSON.stringify({
		lastProvider: 'PrivateProvider',
		lastModel: 'private-model',
	});
	await fs.writeFile(
		path.join(sourceConfigDir, 'agents.config.json'),
		userConfigContents,
	);
	await fs.writeFile(preferencesPath, preferencesContents);
	await fs.writeFile(
		providersFilePath,
		JSON.stringify(fileEnvironmentProviders),
	);

	const capturePath = path.join(tempRoot, 'captured-run-config.json');
	const fileCapturePath = path.join(
		tempRoot,
		'captured-run-config-from-file.json',
	);
	const previousEnvironment = {
		configDir: process.env.NANOCODER_CONFIG_DIR,
		providers: process.env.NANOCODER_PROVIDERS,
		providersFile: process.env.NANOCODER_PROVIDERS_FILE,
		mcpServers: process.env.NANOCODER_MCPSERVERS,
		mcpServersFile: process.env.NANOCODER_MCPSERVERS_FILE,
		capturePath: process.env.AGENT_EVAL_CAPTURE_PATH,
	};
	process.env.NANOCODER_CONFIG_DIR = sourceConfigDir;
	process.env.NANOCODER_PROVIDERS = JSON.stringify(environmentProviders);
	process.env.NANOCODER_PROVIDERS_FILE = providersFilePath;
	process.env.NANOCODER_MCPSERVERS = '[{"name":"private-env-server"}]';
	process.env.NANOCODER_MCPSERVERS_FILE = path.join(
		sourceConfigDir,
		'private-mcp.json',
	);
	process.env.AGENT_EVAL_CAPTURE_PATH = capturePath;

	try {
		const cliPath = await stubCli(`
			import {existsSync, readFileSync, writeFileSync} from 'node:fs';
			import {join} from 'node:path';
			const configDir = process.env.NANOCODER_CONFIG_DIR;
			const configPath = join(configDir, 'agents.config.json');
			const preferencesPath = join(configDir, 'nanocoder-preferences.json');
			const capture = {
				configDir,
				config: JSON.parse(readFileSync(configPath, 'utf8')),
				preferencesExisted: existsSync(preferencesPath),
				providersEnv: process.env.NANOCODER_PROVIDERS ?? null,
				providersFile: process.env.NANOCODER_PROVIDERS_FILE ?? null,
				mcpServers: process.env.NANOCODER_MCPSERVERS ?? null,
				mcpServersFile: process.env.NANOCODER_MCPSERVERS_FILE ?? null,
			};
			writeFileSync(process.env.AGENT_EVAL_CAPTURE_PATH, JSON.stringify(capture));
			writeFileSync(preferencesPath, JSON.stringify({lastProvider: 'Ollama', lastModel: 'changed'}));
			process.stdout.write(JSON.stringify({kind: 'success', exitCode: 0, finalText: 'done', steps: 1}));
		`);
		const run = await runOnce({
			cliPath,
			fixture: await fixture([{kind: 'files-unchanged'}]),
			provider: 'ollama',
			workspaceRoot: tempRoot,
		});

		t.true(run.pass);
		const captured = JSON.parse(await fs.readFile(capturePath, 'utf8')) as {
			configDir: string;
			config: unknown;
			preferencesExisted: boolean;
			providersEnv: string | null;
			providersFile: string | null;
			mcpServers: string | null;
			mcpServersFile: string | null;
		};
		t.not(captured.configDir, sourceConfigDir);
		t.deepEqual(captured.config, {
			nanocoder: {providers: [environmentProviders[0]]},
		});
		t.false(captured.preferencesExisted);
		t.is(captured.providersEnv, null);
		t.is(captured.providersFile, null);
		t.is(captured.mcpServers, null);
		t.is(captured.mcpServersFile, null);
		t.is(
			await fs.readFile(path.join(sourceConfigDir, 'agents.config.json'), 'utf8'),
			userConfigContents,
		);
		t.is(await fs.readFile(preferencesPath, 'utf8'), preferencesContents);
		await t.throwsAsync(() => fs.stat(captured.configDir), {code: 'ENOENT'});

		delete process.env.NANOCODER_PROVIDERS;
		process.env.AGENT_EVAL_CAPTURE_PATH = fileCapturePath;
		const fileRun = await runOnce({
			cliPath,
			fixture: await fixture([{kind: 'files-unchanged'}]),
			provider: 'ollama',
			workspaceRoot: tempRoot,
		});
		t.true(fileRun.pass);
		const capturedFromFile = JSON.parse(
			await fs.readFile(fileCapturePath, 'utf8'),
		) as typeof captured;
		t.deepEqual(capturedFromFile.config, {
			nanocoder: {providers: [fileEnvironmentProviders[0]]},
		});
		t.is(capturedFromFile.providersEnv, null);
		t.is(capturedFromFile.providersFile, null);
		t.is(capturedFromFile.mcpServers, null);
		t.is(capturedFromFile.mcpServersFile, null);
		await t.throwsAsync(() => fs.stat(capturedFromFile.configDir), {
			code: 'ENOENT',
		});
	} finally {
		if (previousEnvironment.configDir === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previousEnvironment.configDir;
		}
		if (previousEnvironment.providers === undefined) {
			delete process.env.NANOCODER_PROVIDERS;
		} else {
			process.env.NANOCODER_PROVIDERS = previousEnvironment.providers;
		}
		if (previousEnvironment.providersFile === undefined) {
			delete process.env.NANOCODER_PROVIDERS_FILE;
		} else {
			process.env.NANOCODER_PROVIDERS_FILE =
				previousEnvironment.providersFile;
		}
		if (previousEnvironment.mcpServers === undefined) {
			delete process.env.NANOCODER_MCPSERVERS;
		} else {
			process.env.NANOCODER_MCPSERVERS = previousEnvironment.mcpServers;
		}
		if (previousEnvironment.mcpServersFile === undefined) {
			delete process.env.NANOCODER_MCPSERVERS_FILE;
		} else {
			process.env.NANOCODER_MCPSERVERS_FILE = previousEnvironment.mcpServersFile;
		}
		if (previousEnvironment.capturePath === undefined) {
			delete process.env.AGENT_EVAL_CAPTURE_PATH;
		} else {
			process.env.AGENT_EVAL_CAPTURE_PATH = previousEnvironment.capturePath;
		}
	}
});

test('runOnce fails the run when an assertion does not hold', async t => {
	const cliPath = await stubCli(`
		process.stdout.write(JSON.stringify({
			kind: 'success', exitCode: 0, finalText: 'all done', steps: 3,
		}));
	`);

	const run = await runOnce({
		cliPath,
		fixture: await fixture([
			{kind: 'file-contains', path: 'src/config.js', text: '5000'},
		]),
		workspaceRoot: tempRoot,
	});

	t.false(run.pass);
	t.regex(String(run.failure), /does not contain/);
	// The run still measured: a wrong answer costs steps too.
	t.is(run.steps, 3);
});

test('runOnce still measures a run that exits non-zero with a report', async t => {
	const cliPath = await stubCli(`
		process.stdout.write(JSON.stringify({
			kind: 'error', exitCode: 1, finalText: '', steps: 2,
			message: 'model exploded',
		}));
		process.exit(1);
	`);

	const run = await runOnce({
		cliPath,
		fixture: await fixture([{kind: 'files-unchanged'}]),
		workspaceRoot: tempRoot,
	});

	t.is(run.steps, 2);
	t.false(run.pass, 'an error cannot pass merely by leaving the tree untouched');
	t.regex(run.failure ?? '', /CLI run failed/);
});

test('runOnce reports a harness failure when the CLI prints nothing', async t => {
	const cliPath = await stubCli('process.exit(9);');

	const run = await runOnce({
		cliPath,
		fixture: await fixture([{kind: 'files-unchanged'}]),
		workspaceRoot: tempRoot,
	});

	t.false(run.pass);
	t.truthy(run.failure);
	t.is(run.steps, 0);
});

for (const [kind, exitCode, processExit] of [
	['tool-approval-required', 2, 2],
	['success', 0, 9],
] as const) {
	test(`runOnce rejects ${kind} with process exit ${processExit} even when assertions pass`, async t => {
		const cliPath = await stubCli(`
			process.stdout.write(JSON.stringify({kind: '${kind}', exitCode: ${exitCode}, steps: 4}));
			process.exit(${processExit});
		`);
		const run = await runOnce({
			cliPath,
			fixture: await fixture([{kind: 'files-unchanged'}]),
			workspaceRoot: tempRoot,
		});
		t.false(run.pass);
		t.is(run.steps, 4);
		t.regex(run.failure ?? '', /CLI run failed/);
	});
}

test('runOnce leaves the vendored fixture untouched', async t => {
	const cliPath = await stubCli(`
		import {writeFileSync} from 'node:fs';
		writeFileSync('src/config.js', 'TIMEOUT = 5000\\n');
		process.stdout.write(JSON.stringify({kind:'success',exitCode:0,steps:1}));
	`);
	const task = await fixture([
		{kind: 'file-contains', path: 'src/config.js', text: '5000'},
	]);
	const before = await hashTree(task.dir);

	await runOnce({cliPath, fixture: task, workspaceRoot: tempRoot});

	t.is(await hashTree(task.dir), before);
});

test('runOnce prices the run when a pricing lookup is supplied', async t => {
	const cliPath = await stubCli(`
		process.stdout.write(JSON.stringify({
			kind: 'success', exitCode: 0, steps: 1,
			usage: {inputTokens: 1_000_000, outputTokens: 1_000_000},
		}));
	`);

	const run = await runOnce({
		cliPath,
		fixture: await fixture([{kind: 'files-unchanged'}]),
		workspaceRoot: tempRoot,
		model: 'test-model',
		getPricing: async () => ({input: 3, output: 15}),
	});

	t.is(run.costUsd, 18);
});

test('runOnce keeps the run when the pricing lookup throws', async t => {
	const cliPath = await stubCli(`
		process.stdout.write(JSON.stringify({kind:'success',exitCode:0,steps:1}));
	`);

	const run = await runOnce({
		cliPath,
		fixture: await fixture([{kind: 'files-unchanged'}]),
		workspaceRoot: tempRoot,
		model: 'test-model',
		getPricing: async () => {
			throw new Error('models.dev unreachable');
		},
	});

	t.true(run.pass);
	t.is(run.costUsd, null);
});

// ============================================================================
// Summaries
// ============================================================================

const taskRun = (overrides: Partial<TaskRun> = {}): TaskRun => ({
	fixture: 'stub-task',
	pass: true,
	steps: 4,
	inputTokens: 100,
	outputTokens: 10,
	totalTokens: 110,
	costUsd: null,
	durationMs: 1000,
	...overrides,
});

test('summarize reports the pass count, median and spread', async t => {
	const task = await fixture([{kind: 'files-unchanged'}]);
	const summary = summarize(task, [
		taskRun({steps: 2}),
		taskRun({steps: 4}),
		taskRun({steps: 6}),
		taskRun({steps: 8}),
		taskRun({steps: 30, pass: false, failure: 'src/config.js is missing'}),
	]);

	t.is(summary.runs, 5);
	t.is(summary.passed, 4);
	t.is(summary.steps.median, 6);
	t.is(summary.category, 'single-file-edit');
	t.deepEqual(summary.failures, ['src/config.js is missing']);
	t.is(summary.costUsd, null, 'an unpriced tier reports no cost');
});

test('summarize collapses repeated failures and prices only priced runs', async t => {
	const task = await fixture([{kind: 'files-unchanged'}]);
	const summary = summarize(task, [
		taskRun({pass: false, failure: 'same failure'}),
		taskRun({pass: false, failure: 'same failure'}),
		taskRun({costUsd: 0.5}),
		taskRun({costUsd: 1.5}),
	]);

	t.deepEqual(summary.failures, ['same failure']);
	t.is(summary.costUsd?.median, 1);
});
