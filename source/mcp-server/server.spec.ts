import {mkdirSync, mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import test from 'ava';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';
import {InMemoryTransport} from '@modelcontextprotocol/sdk/inMemory.js';
import type {Server} from '@modelcontextprotocol/sdk/server/index.js';
import type {CallToolResult} from '@modelcontextprotocol/sdk/types.js';
import {clearAppConfig, reloadAppConfig} from '@/config/index';
import {
	clearProfileCache,
	resolveActiveProfile,
} from '@/config/profile';
import type {HeadlessReviewJson} from '@/review/headless-review';
import {setProjectRoot} from '@/services/session-cwd';
import {
	createNanocoderMcpServer,
	runMcpServer,
} from './server.js';

type ServerOptions = Parameters<typeof createNanocoderMcpServer>[0];
type Dependencies = NonNullable<ServerOptions['deps']>;
type TaskRunner = NonNullable<Dependencies['runTask']>;
type ReviewRunner = NonNullable<Dependencies['reviewDiff']>;
type RunTaskInput = Parameters<TaskRunner>[0];
type RunTaskResult = Awaited<ReturnType<TaskRunner>>;
type ReviewInput = Parameters<ReviewRunner>[0];
type ReviewResult = Awaited<ReturnType<ReviewRunner>>;

const taskResult = (
	overrides: Partial<RunTaskResult> = {},
): RunTaskResult => ({
	status: 'success',
	finalText: 'fixture task complete',
	filesChanged: [],
	toolCalls: [],
	steps: 1,
	...overrides,
});

const reviewResult = (
	overrides: Partial<ReviewResult> = {},
): ReviewResult => ({
	status: 'completed',
	tier: 'quick',
	report: {
		tier: 'quick',
		status: 'completed',
		findings: [],
		dropped: [],
		unverified: [],
		incompleteReasons: [],
		notes: [],
		stats: {},
	} as HeadlessReviewJson,
	exitCode: 0,
	...overrides,
});

const createHarness = async (
	options: ServerOptions,
): Promise<{
	server: Server;
	client: Client;
	close: () => Promise<void>;
}> => {
	const server = createNanocoderMcpServer(options);
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({name: 'nanocoder-mcp-test', version: '1.0.0'});
	await server.connect(serverTransport);
	await client.connect(clientTransport);
	return {
		server,
		client,
		close: async () => {
			await client.close();
			await server.close();
		},
	};
};

const trustedDependencies = (
	deps: Partial<Dependencies> = {},
): Partial<Dependencies> => ({
	resolveTrust: () => ({trusted: true}),
	...deps,
});

const textResult = (result: CallToolResult): string => {
	const textBlock = result.content.find(block => block.type === 'text');
	return textBlock?.type === 'text' ? textBlock.text : '';
};

const deferred = () => {
	let resolve!: () => void;
	const promise = new Promise<void>(resolvePromise => {
		resolve = () => resolvePromise();
	});
	return {promise, resolve};
};

test('MCP server exposes the explicit run_task and review_diff contract', async t => {
	const harness = await createHarness({
		cwd: process.cwd(),
		trustDirectory: true,
		deps: trustedDependencies({
			runTask: async () => taskResult(),
			reviewDiff: async () => reviewResult(),
		}),
	});
	t.teardown(harness.close);

	const listed = await harness.client.listTools();
	t.deepEqual(
		listed.tools.map(tool => tool.name).sort(),
		['review_diff', 'run_task'],
	);

	const runTask = listed.tools.find(tool => tool.name === 'run_task');
	const reviewDiff = listed.tools.find(tool => tool.name === 'review_diff');
	t.truthy(runTask);
	t.truthy(reviewDiff);
	t.deepEqual(runTask?.inputSchema.required, ['prompt']);
	t.deepEqual(
		Object.keys(runTask?.inputSchema.properties ?? {}).sort(),
		['cwd', 'mode', 'model', 'prompt'],
	);
	t.deepEqual(
		Object.keys(reviewDiff?.inputSchema.properties ?? {}).sort(),
		['cwd', 'model', 'request', 'tier'],
	);
});

test('run_task defaults to plan mode and returns a structured result', async t => {
	let received: RunTaskInput | undefined;
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: trustedDependencies({
			runTask: async input => {
				received = input;
				return taskResult({
					finalText: 'The fixture task completed.',
					filesChanged: ['src/example.ts'],
				});
			},
		}),
	});
	t.teardown(harness.close);

	const result = await harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'Update the fixture'},
	});

	t.is(received?.mode, 'plan');
	t.is(received?.prompt, 'Update the fixture');
	t.not(result.isError, true);
	t.is(result.structuredContent?.status, 'success');
	t.is(result.structuredContent?.finalText, 'The fixture task completed.');
	t.deepEqual(result.structuredContent?.filesChanged, ['src/example.ts']);
	t.deepEqual(JSON.parse(textResult(result)), result.structuredContent);
});

test('run_task cannot raise the mode above the server launch mode', async t => {
	const received: RunTaskInput[] = [];
	const harness = await createHarness({
		cwd: process.cwd(),
		developmentMode: 'plan',
		deps: trustedDependencies({
			runTask: async input => {
				received.push(input);
				return taskResult();
			},
		}),
	});
	t.teardown(harness.close);

	const result = await harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'Attempt a yolo request', mode: 'yolo'},
	});

	t.is(result.isError, true);
	t.true(textResult(result).includes('mode_ceiling_exceeded'));
	t.deepEqual(received, []);
});

test('run_task permits yolo only when the server was explicitly started in yolo mode', async t => {
	let received: RunTaskInput | undefined;
	const harness = await createHarness({
		cwd: process.cwd(),
		developmentMode: 'yolo',
		deps: trustedDependencies({
			runTask: async input => {
				received = input;
				return taskResult();
			},
		}),
	});
	t.teardown(harness.close);

	const result = await harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'Run the fixture', mode: 'yolo'},
	});

	t.not(result.isError, true);
	t.is(received?.mode, 'yolo');
});

test('untrusted directories are refused before a task runner is invoked', async t => {
	let called = false;
	let trustCheck: {cwd: string; bypass: boolean} | undefined;
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: {
			resolveTrust: (cwd, bypass) => {
				trustCheck = {cwd, bypass};
				return {trusted: false, message: 'This fixture directory is untrusted.'};
			},
			runTask: async () => {
				called = true;
				return taskResult();
			},
		},
	});
	t.teardown(harness.close);

	const result = await harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'Do not run'},
	});

	t.is(result.isError, true);
	t.true(textResult(result).includes('untrusted'));
	t.false(called);
	t.deepEqual(trustCheck, {cwd: process.cwd(), bypass: false});
});

test('directory trust is rechecked for every task instead of cached at startup', async t => {
	let trusted = true;
	const calls: RunTaskInput[] = [];
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: {
			resolveTrust: () => ({
				trusted,
				message: 'The project trust fingerprint changed.',
			}),
			runTask: async input => {
				calls.push(input);
				trusted = false;
				return taskResult();
			},
		},
	});
	t.teardown(harness.close);

	const first = await harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'First task'},
	});
	const second = await harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'Second task after trust changed'},
	});

	t.not(first.isError, true);
	t.is(second.isError, true);
	t.true(textResult(second).includes('fingerprint changed'));
	t.is(calls.length, 1);
});

test('run_task preserves a non-interactive tool-approval-required result', async t => {
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: trustedDependencies({
			runTask: async () =>
				taskResult({
					status: 'tool-approval-required',
					message: 'A prompt hook refused this task.',
				}),
		}),
	});
	t.teardown(harness.close);

	const result = await harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'A prompt rejected by policy'},
	});

	t.not(result.isError, true);
	t.is(result.structuredContent?.status, 'tool-approval-required');
	t.is(result.structuredContent?.message, 'A prompt hook refused this task.');
});

test.serial('run_task honors a project prompt-hook veto before making a model call', async t => {
	const previousCwd = process.cwd();
	const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
	const previousDataDir = process.env.NANOCODER_DATA_DIR;
	const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'nanocoder-mcp-hook-'));
	const projectCwd = path.join(fixtureRoot, 'project');
	const configDir = path.join(fixtureRoot, 'user-config');
	const dataDir = path.join(fixtureRoot, 'data');
	mkdirSync(projectCwd);
	mkdirSync(configDir);
	writeFileSync(
		path.join(projectCwd, 'agents.config.json'),
		JSON.stringify({
			nanocoder: {
				providers: [
					{
						name: 'mcp-hook-fixture',
						baseUrl: 'http://127.0.0.1:1/v1',
						models: ['mcp-hook-fixture-model'],
						contextWindow: 4096,
					},
				],
				hooks: {
					'user-prompt-submit': [
						{
							name: 'fixture-guard',
							command: 'node -e "console.log(\'fixture refusal\');process.exit(1)"',
						},
					],
				},
			},
		}),
	);
	process.env.NANOCODER_CONFIG_DIR = configDir;
	process.env.NANOCODER_DATA_DIR = dataDir;
	process.chdir(projectCwd);
	setProjectRoot(projectCwd);
	clearAppConfig();
	reloadAppConfig();

	let closeHarness: (() => Promise<void>) | undefined;
	try {
		const harness = await createHarness({
			cwd: projectCwd,
			trustDirectory: true,
			cliProvider: 'mcp-hook-fixture',
			cliModel: 'mcp-hook-fixture-model',
		});
		closeHarness = harness.close;
		const result = await harness.client.callTool({
			name: 'run_task',
			arguments: {prompt: 'The configured hook should refuse this task'},
		});

		t.is(result.isError, true);
		t.is(result.structuredContent?.status, 'error');
		const refusalMessage = String(result.structuredContent?.message);
		t.true(
			refusalMessage.includes('fixture refusal'),
			`expected the hook output in the refusal message, got: ${refusalMessage}`,
		);
		t.is(result.structuredContent?.steps, 0);
	} finally {
		await closeHarness?.();
		process.chdir(previousCwd);
		setProjectRoot(previousCwd);
		if (previousConfigDir === undefined) {
			delete process.env.NANOCODER_CONFIG_DIR;
		} else {
			process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
		}
		if (previousDataDir === undefined) {
			delete process.env.NANOCODER_DATA_DIR;
		} else {
			process.env.NANOCODER_DATA_DIR = previousDataDir;
		}
		clearAppConfig();
		reloadAppConfig();
		rmSync(fixtureRoot, {recursive: true, force: true});
	}
});

test.serial(
	'a saved yolo profile does not elevate a server without explicit yolo mode',
	async t => {
		const previousCwd = process.cwd();
		const previousConfigDir = process.env.NANOCODER_CONFIG_DIR;
		const fixtureRoot = mkdtempSync(path.join(tmpdir(), 'nanocoder-mcp-profile-'));
		const projectCwd = path.join(fixtureRoot, 'project');
		const configDir = path.join(fixtureRoot, 'user-config');
		mkdirSync(projectCwd);
		mkdirSync(configDir);
		writeFileSync(
			path.join(projectCwd, 'agents.config.json'),
			JSON.stringify({
				nanocoder: {
					defaultProfile: 'unattended',
					profiles: {unattended: {mode: 'yolo'}},
				},
			}),
		);
		process.env.NANOCODER_CONFIG_DIR = configDir;
		process.chdir(projectCwd);
		setProjectRoot(projectCwd);
		clearProfileCache();
		clearAppConfig();
		reloadAppConfig();

		let received: RunTaskInput | undefined;
		let closeHarness: (() => Promise<void>) | undefined;
		try {
			t.is(resolveActiveProfile(projectCwd)?.profile.mode, 'yolo');
			const harness = await createHarness({
				cwd: projectCwd,
				deps: trustedDependencies({
					runTask: async input => {
						received = input;
						return taskResult();
					},
				}),
			});
			closeHarness = harness.close;
			const result = await harness.client.callTool({
				name: 'run_task',
				arguments: {prompt: 'Run without an explicit mode'},
			});
			t.not(result.isError, true);
			t.is(received?.mode, 'plan');
		} finally {
			await closeHarness?.();
			process.chdir(previousCwd);
			setProjectRoot(previousCwd);
			if (previousConfigDir === undefined) {
				delete process.env.NANOCODER_CONFIG_DIR;
			} else {
				process.env.NANOCODER_CONFIG_DIR = previousConfigDir;
			}
			clearProfileCache();
			clearAppConfig();
			reloadAppConfig();
			rmSync(fixtureRoot, {recursive: true, force: true});
		}
	},
);

test.serial('run_task rejects cwd values outside the server launch directory', async t => {
	const previousCwd = process.cwd();
	const parent = mkdtempSync(path.join(tmpdir(), 'nanocoder-mcp-cwd-'));
	const launchCwd = path.join(parent, 'project');
	const outsideCwd = path.join(parent, 'outside');
	mkdirSync(launchCwd);
	mkdirSync(outsideCwd);
	process.chdir(launchCwd);

	const received: RunTaskInput[] = [];
	let closeHarness: (() => Promise<void>) | undefined;
	try {
		const harness = await createHarness({
			cwd: launchCwd,
			deps: trustedDependencies({
				runTask: async input => {
					received.push(input);
					return taskResult();
				},
			}),
		});
		closeHarness = harness.close;
		const result = await harness.client.callTool({
			name: 'run_task',
			arguments: {prompt: 'Stay in the project', cwd: outsideCwd},
		});
		t.is(result.isError, true);
		t.deepEqual(received, []);
	} finally {
		await closeHarness?.();
		process.chdir(previousCwd);
		rmSync(parent, {recursive: true, force: true});
	}
});

test('run_task reports progress through MCP progress notifications', async t => {
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: trustedDependencies({
			runTask: async input => {
				input.onProgress('Fixture task started');
				return taskResult();
			},
		}),
	});
	t.teardown(harness.close);

	const progress: unknown[] = [];
	const result = await harness.client.callTool(
		{name: 'run_task', arguments: {prompt: 'Run with progress'}},
		undefined,
		{onprogress: notification => progress.push(notification)},
	);

	t.not(result.isError, true);
	t.true(progress.length > 0);
});

test('task execution is serialized even when a client sends concurrent calls', async t => {
	const firstStarted = deferred();
	const releaseFirst = deferred();
	let active = 0;
	let maxActive = 0;
	const startedPrompts: string[] = [];
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: trustedDependencies({
			runTask: async input => {
				active++;
				maxActive = Math.max(maxActive, active);
				startedPrompts.push(input.prompt);
				if (input.prompt === 'first') {
					firstStarted.resolve();
					await releaseFirst.promise;
				}
				active--;
				return taskResult();
			},
		}),
	});
	t.teardown(harness.close);

	const firstCall = harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'first'},
	});
	await firstStarted.promise;
	const secondCall = harness.client.callTool({
		name: 'run_task',
		arguments: {prompt: 'second'},
	});
	await new Promise<void>(resolve => setImmediate(resolve));
	t.deepEqual(startedPrompts, ['first']);

	releaseFirst.resolve();
	const [first, second] = await Promise.all([firstCall, secondCall]);
	t.not(first.isError, true);
	t.not(second.isError, true);
	t.deepEqual(startedPrompts, ['first', 'second']);
	t.is(maxActive, 1);
});

test('MCP request cancellation reaches the task runner', async t => {
	let receivedSignal: AbortSignal | undefined;
	let resolveStarted: (() => void) | undefined;
	let resolveCancelled: (() => void) | undefined;
	const started = new Promise<void>(resolve => {
		resolveStarted = resolve;
	});
	const runnerCancelled = new Promise<void>(resolve => {
		resolveCancelled = resolve;
	});
	const controller = new AbortController();
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: trustedDependencies({
			runTask: input => {
				receivedSignal = input.signal;
				resolveStarted?.();
				return new Promise<RunTaskResult>(resolve => {
					input.signal.addEventListener(
						'abort',
						() => {
							resolveCancelled?.();
							resolve(taskResult({status: 'cancelled'}));
						},
						{once: true},
					);
				});
			},
		}),
	});
	t.teardown(harness.close);

	const pending = harness.client.callTool(
		{name: 'run_task', arguments: {prompt: 'Wait for cancellation'}},
		undefined,
		{signal: controller.signal},
	);
	await started;
	controller.abort();
	await t.throwsAsync(pending);
	await runnerCancelled;
	t.true(receivedSignal?.aborted);
});

test('MCP runtime aborts active work and drains it when the transport closes', async t => {
	const [clientTransport, serverTransport] =
		InMemoryTransport.createLinkedPair();
	const client = new Client({name: 'nanocoder-mcp-shutdown-test', version: '1.0.0'});
	let receivedSignal: AbortSignal | undefined;
	const started = deferred();
	const runnerAborted = deferred();
	const serverRun = runMcpServer(
		{
			cwd: process.cwd(),
			deps: trustedDependencies({
				runTask: input => {
					receivedSignal = input.signal;
					started.resolve();
					return new Promise<RunTaskResult>(resolve => {
						input.signal.addEventListener(
							'abort',
							() => {
								runnerAborted.resolve();
								resolve(taskResult({status: 'cancelled'}));
							},
							{once: true},
						);
					});
				},
			}),
		},
		serverTransport,
	);
	let clientClosed = false;
	const closeClient = async () => {
		if (clientClosed) return;
		clientClosed = true;
		await client.close();
	};
	t.teardown(async () => {
		await closeClient();
		await serverRun;
	});
	await client.connect(clientTransport);

	const call = client.callTool({
		name: 'run_task',
		arguments: {prompt: 'Cancel when the client disconnects'},
	});
	await started.promise;
	await closeClient();
	await t.throwsAsync(call);
	await t.notThrowsAsync(serverRun);
	await runnerAborted.promise;
	t.true(receivedSignal?.aborted);
});

test('review_diff forwards the requested tier and returns its fixture report', async t => {
	let received: ReviewInput | undefined;
	const harness = await createHarness({
		cwd: process.cwd(),
		deps: trustedDependencies({
			reviewDiff: async input => {
				received = input;
				return reviewResult();
			},
		}),
	});
	t.teardown(harness.close);

	const result = await harness.client.callTool({
		name: 'review_diff',
		arguments: {request: 'Review this fixture', tier: 'quick'},
	});

	t.is(received?.tier, 'quick');
	t.is(received?.request, 'Review this fixture');
			t.not(result.isError, true);
	t.is(result.structuredContent?.status, 'completed');
	t.is(result.structuredContent?.tier, 'quick');
});

test('stdio runtime serves real MCP client calls with deterministic injected runners', async t => {
	const dataDir = mkdtempSync(path.join(tmpdir(), 'nanocoder-mcp-stdio-'));
	t.teardown(() => rmSync(dataDir, {recursive: true, force: true}));
	const bootstrap = `
import {runMcpServer} from './source/mcp-server/server.ts';
await runMcpServer({
  cwd: process.cwd(),
  trustDirectory: true,
  deps: {
    resolveTrust: () => ({trusted: true}),
			runTask: async () => {
				console.log('MCP_TEST_NOISY_RUNNER_OUTPUT');
				return {
					status: 'success',
					finalText: 'stdio fixture complete',
					filesChanged: [],
					toolCalls: [],
					steps: 1,
				};
			},
  },
});
`;
	const env: Record<string, string> = {
		NODE_ENV: 'test',
		NANOCODER_DATA_DIR: dataDir,
		PATH: process.env.PATH ?? '',
	};
	for (const key of ['SystemRoot', 'TEMP', 'TMP']) {
		const value = process.env[key];
		if (value) env[key] = value;
	}

	const transport = new StdioClientTransport({
		command: process.execPath,
		args: ['--import', 'tsx', '--input-type=module', '-e', bootstrap],
		cwd: process.cwd(),
		env,
		stderr: 'pipe',
	});
	let stderr = '';
	transport.stderr?.on('data', (chunk: Buffer) => {
		stderr += chunk.toString('utf8');
	});
	const client = new Client({name: 'nanocoder-mcp-stdio-test', version: '1.0.0'});
	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		await client.close();
	};
	t.teardown(close);

	try {
		await client.connect(transport, {timeout: 10_000});
		const listed = await client.listTools();
		t.true(listed.tools.some(tool => tool.name === 'run_task'));
		const result = await client.callTool({
			name: 'run_task',
			arguments: {prompt: 'Use the deterministic stdio runner'},
		});
		t.is(result.structuredContent?.finalText, 'stdio fixture complete');
		t.not(result.isError, true);
	} catch (error) {
		if (stderr) t.fail(`stdio server stderr: ${stderr}`);
		throw error;
	} finally {
		await close();
	}
});
