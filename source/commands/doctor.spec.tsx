import test from 'ava';
import React from 'react';
import {renderWithTheme} from '../test-utils/render-with-theme.js';
import {
	collectDoctorReport,
	Doctor,
	doctorCommand,
	type DoctorDependencies,
} from './doctor';

console.log('\ndoctor.spec.tsx');

const fixedNow = 1_700_003_600_000;
const fixedStartedAt = fixedNow - 3_600_000;

function createDependencies(
	overrides: Partial<DoctorDependencies> = {},
): DoctorDependencies {
	return {
		now: () => fixedNow,
		getVersion: async () => '1.2.3',
		getProviders: () => [
			{
				name: 'Ollama',
				type: 'openai',
				models: ['llama3', 'qwen'],
				config: {
					baseURL: 'http://localhost:11434/v1',
					apiKey: 'secret-local-key',
				},
			},
			{
				name: 'OpenRouter',
				type: 'openai',
				models: ['anthropic/claude-sonnet-4'],
				config: {
					baseURL:
						'https://user:secret@openrouter.ai/api/v1/path-secret?token=url-secret',
					apiKey: 'secret-hosted-key',
				},
			},
		],
		getLspStatus: async () => ({
			initialized: true,
			servers: [
				{
					name: 'typescript-language-server',
					ready: true,
					languages: ['ts', 'tsx'],
				},
			],
		}),
		getToolManager: () =>
			({
				getConnectedServers: () => ['filesystem'],
				getServerTools: () => [
					{name: 'read_file', description: 'Read file'},
					{name: 'write_file', description: 'Write file'},
				],
				getServerInfo: () => ({
					name: 'filesystem',
					transport: 'stdio',
					connected: true,
					description: 'Project filesystem',
					url: 'https://user:mcp-secret@mcp.example/server/path-secret?token=mcp-token',
				}),
			}) as never,
		getDaemonLock: async () => ({
			pid: 1234,
			socketPath: '/tmp/nanocoder.sock',
			startedAt: fixedStartedAt,
			projectRoot: '/tmp/project',
		}),
		probeLocalProvider: async () => 'reachable',
		getProviderModels: async () => ({
			success: true,
			statusCode: 200,
			models: [
				{id: 'llama3', name: 'llama3'},
				{id: 'anthropic/claude-sonnet-4', name: 'Claude'},
			],
		}),
		probeExecutable: async () => true,
		...overrides,
	};
}

test('Doctor renders all diagnostic sections in one report', async t => {
	const report = await collectDoctorReport(createDependencies());

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	const output = lastFrame();

	t.truthy(output);
	t.regex(output!, /\/doctor/);
	t.regex(output!, /System/);
	t.regex(output!, /Nanocoder/);
	t.regex(output!, /Providers/);
	t.regex(output!, /LSP/);
	t.regex(output!, /MCP/);
	t.regex(output!, /Hooks/);
	t.regex(output!, /Formatters/);
	t.regex(output!, /Daemon/);
});

test('Doctor lists configured lifecycle hooks', async t => {
	const report = await collectDoctorReport(createDependencies());

	const withHooks = {
		...report,
		hooks: {
			status: 'ok' as const,
			data: [
				{
					event: 'post-tool-use' as const,
					label: 'format',
					matchTools: ['write_file'],
				},
				{event: 'session-start' as const, label: 'git log --oneline -5'},
			],
		},
	};

	const {lastFrame} = renderWithTheme(<Doctor report={withHooks} />);
	const output = lastFrame()!;

	t.regex(output, /post-tool-use: format/);
	t.regex(output, /write_file/);
	t.regex(output, /session-start: git log/);
});

test('Doctor reports when no lifecycle hooks are configured', async t => {
	const report = await collectDoctorReport(createDependencies());

	// The test config directory has no hooks, so this is the real collector's
	// empty result, not a stub.
	t.is(report.hooks.status, 'ok');

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	t.regex(lastFrame()!, /No lifecycle hooks configured/);
});

test('Doctor lists configured formatters', async t => {
	const report = await collectDoctorReport(createDependencies());

	const withFormatters = {
		...report,
		formatters: {
			status: 'ok' as const,
			data: [
				{label: 'biome', match: ['**/*.ts', '**/*.tsx']},
				{label: 'gofmt -w "$FILE"', match: ['**/*.go']},
			],
		},
	};

	const {lastFrame} = renderWithTheme(<Doctor report={withFormatters} />);
	const output = lastFrame()!;

	t.regex(output, /biome • \*\*\/\*\.ts, \*\*\/\*\.tsx/);
	t.regex(output, /gofmt -w "\$FILE" • \*\*\/\*\.go/);
});

test('Doctor reports when no formatters are configured', async t => {
	const report = await collectDoctorReport(createDependencies());

	t.is(report.formatters.status, 'ok');

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	t.regex(lastFrame()!, /No formatters configured/);
});

test('Doctor reports providers without leaking api keys', async t => {
	const report = await collectDoctorReport(createDependencies());

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	const output = lastFrame()!;

	t.regex(output, /Ollama/);
	t.regex(output, /2 models/);
	t.regex(output, /local/);
	t.regex(output, /reachable/);
	t.regex(output, /OpenRouter/);
	t.regex(output, /hosted/);
	t.regex(output, /https:\/\/openrouter\.ai/);
	t.regex(output, /https:\/\/mcp\.example/);
	t.notRegex(output, /secret-local-key/);
	t.notRegex(output, /secret-hosted-key/);
	t.notRegex(output, /path-secret|url-secret|mcp-secret|mcp-token/);
	t.notRegex(output, /apiKey/);
});

test('deep provider and tool checks run only on request and report safe outcomes', async t => {
	let providerCalls = 0;
	const probedTools: string[] = [];
	const dependencies = createDependencies({
		getProviderModels: async baseURL => {
			providerCalls++;
			if (baseURL.includes('openrouter'))
				return {
					success: false,
					statusCode: 401,
					models: [],
					error: 'secret-hosted-key must never be rendered',
				};
			return {
				success: true,
				statusCode: 200,
				models: [{id: 'llama3', name: 'llama3'}],
			};
		},
		probeExecutable: async command => {
			probedTools.push(command);
			return command === 'git';
		},
	});

	const fast = await collectDoctorReport(dependencies);
	t.is(fast.deepChecks, undefined);
	t.is(providerCalls, 0);
	t.deepEqual(probedTools, []);

	const report = await collectDoctorReport(dependencies, {probe: true});
	t.is(report.providers.status, 'ok');
	if (report.providers.status !== 'ok') return;
	t.deepEqual(report.deepChecks?.tools, [
		{name: 'rg', available: false},
		{name: 'git', available: true},
	]);
	t.is(report.deepChecks?.nodeSupported, true);
	t.deepEqual(report.providers.data[0]?.apiProbe, {
		status: 'response',
		httpStatus: 200,
		models: [
			{id: 'llama3', status: 'available'},
			{id: 'qwen', status: 'not-listed'},
		],
	});
	t.deepEqual(report.providers.data[1]?.apiProbe, {
		status: 'http-error',
		httpStatus: 401,
		hint: 'Authentication rejected',
		models: [{id: 'anthropic/claude-sonnet-4', status: 'unknown'}],
	});
	t.is(providerCalls, 2);
	t.deepEqual(probedTools, ['rg', 'git']);
	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	const output = lastFrame()!;
	t.regex(output, /Deep checks/);
	t.regex(output, /API/);
	t.regex(output, /HTTP 200/);
	t.regex(output, /Authentication rejected/);
	t.regex(output, /llama3: available/);
	t.regex(output, /qwen: not-listed/);
	t.notRegex(output, /secret-hosted-key|path-secret|url-secret/);
});

test('Doctor reports LSP MCP and daemon details', async t => {
	const report = await collectDoctorReport(createDependencies());

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	const output = lastFrame()!;

	t.regex(output, /initialized/);
	t.regex(output, /typescript-language-server/);
	t.regex(output, /ready/);
	t.regex(output, /ts, tsx/);
	t.regex(output, /filesystem/);
	t.regex(output, /stdio/);
	t.regex(output, /2 tools/);
	t.regex(output, /running/);
	t.regex(output, /pid 1234/);
	t.regex(output, /\/tmp\/nanocoder\.sock/);
	t.regex(output, /uptime 1h/);
});

test('Doctor reports MCP resource and prompt counts', async t => {
	const report = await collectDoctorReport(
		createDependencies({
			getToolManager: () =>
				({
					getConnectedServers: () => ['docs-server'],
					getServerTools: () => [
						{name: 'search_docs', description: 'Search docs'},
					],
					getServerInfo: () => ({
						name: 'docs-server',
						transport: 'stdio',
						connected: true,
						resourceCount: 2,
						promptCount: 5,
					}),
				}) as never,
		}),
	);

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	const output = lastFrame()!;

	t.regex(output, /2 resources/);
	t.regex(output, /5 prompts/);
});

test('Doctor handles no LSP MCP or daemon data', async t => {
	const report = await collectDoctorReport(
		createDependencies({
			getLspStatus: async () => ({initialized: false, servers: []}),
			getToolManager: () => null,
			getDaemonLock: async () => null,
		}),
	);

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	const output = lastFrame()!;

	t.regex(output, /not initialized/);
	t.regex(output, /No LSP servers connected/);
	t.regex(output, /No MCP servers connected/);
	t.regex(output, /not running/);
});

test('collectDoctorReport keeps other sections when one source fails', async t => {
	const report = await collectDoctorReport(
		createDependencies({
			getProviders: () => {
				throw new Error('provider config unreadable');
			},
		}),
	);

	t.is(report.providers.status, 'error');
	t.regex(report.providers.error ?? '', /provider config unreadable/);
	t.is(report.lsp.status, 'ok');
	t.is(report.mcp.status, 'ok');
	t.is(report.daemon.status, 'ok');

	const {lastFrame} = renderWithTheme(<Doctor report={report} />);
	t.regex(lastFrame()!, /provider config unreadable/);
});

test('doctorCommand has expected shape', async t => {
	t.is(doctorCommand.name, 'doctor');
	t.is(
		doctorCommand.description,
		'Show environment health report; use --probe for provider checks',
	);

	const element = await doctorCommand.handler([], [], {});
	t.true(React.isValidElement(element));
});
