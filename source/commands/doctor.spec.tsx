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
					baseURL: 'https://openrouter.ai/api/v1',
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
				}),
			}) as never,
		getDaemonLock: async () => ({
			pid: 1234,
			socketPath: '/tmp/nanocoder.sock',
			startedAt: fixedStartedAt,
			projectRoot: '/tmp/project',
		}),
		probeLocalProvider: async () => 'reachable',
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
	t.regex(output!, /Daemon/);
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
	t.regex(output, /https:\/\/openrouter\.ai\/api\/v1/);
	t.notRegex(output, /secret-local-key/);
	t.notRegex(output, /secret-hosted-key/);
	t.notRegex(output, /apiKey/);
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
		'Show environment health report for bug reports',
	);

	const element = await doctorCommand.handler([], [], {});
	t.true(React.isValidElement(element));
});
