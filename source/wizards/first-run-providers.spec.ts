import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import {createServer, type RequestListener} from 'node:http';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test, {type ExecutionContext} from 'ava';
import {substituteEnvVars} from '@/config/env-substitution';
import {
	detectFirstRunProviders,
	getFirstRunSetupPaths,
	saveDetectedProviders,
} from './first-run-providers';
import {fetchModels} from './utils/fetch-models';

const unavailable = {success: false, models: []};

function setupDirs(t: ExecutionContext) {
	const dir = mkdtempSync(join(tmpdir(), 'nanocoder-first-run-'));
	const original = process.env.NANOCODER_CONFIG_DIR;
	const global = join(dir, 'global');
	const project = join(dir, 'project');
	mkdirSync(global);
	mkdirSync(project);
	process.env.NANOCODER_CONFIG_DIR = global;
	t.teardown(() => {
		if (original === undefined) delete process.env.NANOCODER_CONFIG_DIR;
		else process.env.NANOCODER_CONFIG_DIR = original;
		rmSync(dir, {recursive: true, force: true});
	});
	return {global, project, configPath: join(global, 'agents.config.json')};
}

test('discovery uses only loopback URLs and builds hosted configs from variable references', async t => {
	const signal = new AbortController().signal;
	const calls: string[] = [];
	const providers = await detectFirstRunProviders(
		{OPENROUTER_API_KEY: 'secret-test-value', GROQ_API_KEY: '  '},
		signal,
		async (baseUrl, api, key, options) => {
			const url = new URL(baseUrl);
			calls.push(`${url.hostname}:${url.port}`);
			t.is(key, undefined);
			t.is(options?.signal, signal);
			t.is(options?.timeoutMs, 500);
			if (url.port !== '11434') return unavailable;
			t.is(api, 'ollama');
			return {
				success: true,
				models: [
					{id: 'local:model', name: 'Local'},
					{id: 'local:model', name: 'Duplicate'},
					{id: '${OPENAI_API_KEY}', name: 'Literal model id'},
				],
			};
		},
	);
	t.deepEqual(
		calls.sort(),
		[
			'127.0.0.1:11434',
			'127.0.0.1:1234',
			'127.0.0.1:8080',
			'[::1]:1234',
			'[::1]:8080',
		].sort(),
	);
	t.deepEqual(
		providers.map(({config}) => config.name),
		['Ollama', 'OpenRouter'],
	);
	t.deepEqual(substituteEnvVars(providers[0].config.models), [
		'local:model',
		'${OPENAI_API_KEY}',
	]);
	t.is(providers[1].config.apiKey, '${OPENROUTER_API_KEY}');
	t.is(providers[1].keyVariable, 'OPENROUTER_API_KEY');
	t.false(JSON.stringify(providers).includes('secret-test-value'));
});

test('discovery falls back to IPv6 and uses the address that answered', async t => {
	const providers = await detectFirstRunProviders(
		{},
		new AbortController().signal,
		async (address, api) => {
			if (address !== 'http://[::1]:1234/v1') return unavailable;
			t.is(api, 'openai-compatible');
			return {
				success: true,
				models: [{id: 'installed-model', name: 'Installed'}],
			};
		},
	);
	t.deepEqual(
		providers.map(candidate => candidate.config),
		[
			{
				name: 'LM Studio',
				baseUrl: 'http://[::1]:1234/v1',
				models: ['installed-model'],
			},
		],
	);
});

async function startServer(
	t: ExecutionContext,
	listener: RequestListener,
): Promise<string> {
	const server = createServer(listener);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	t.teardown(() => {
		server.closeAllConnections();
		server.close();
	});
	const address = server.address();
	if (!address || typeof address === 'string')
		throw new Error('Expected a TCP server');
	return `http://127.0.0.1:${address.port}`;
}

test('the real discovery request refuses redirects from a loopback server', async t => {
	let redirected = false;
	const destination = await startServer(t, (_request, response) => {
		redirected = true;
		response.end('{"models":[{"name":"unexpected"}]}');
	});
	const origin = await startServer(t, (request, response) => {
		t.is(request.url, '/api/tags');
		t.is(request.headers.authorization, undefined);
		response.writeHead(302, {Location: destination});
		response.end();
	});
	const providers = await detectFirstRunProviders(
		{},
		new AbortController().signal,
		async (address, api, key, options) => {
			if (address !== 'http://127.0.0.1:11434/v1') return unavailable;
			return fetchModels(origin, api, key, options);
		},
	);
	t.deepEqual(providers, []);
	t.false(redirected);
});

test('an aborted discovery skips all local probes', async t => {
	const providers = await detectFirstRunProviders(
		{},
		AbortSignal.abort(),
		async () => {
			t.fail('A cancelled setup should not probe local servers');
			return unavailable;
		},
	);
	t.deepEqual(providers, []);
});

test.serial(
	'first-run paths accept absent and generated placeholder configs only',
	t => {
		const {project, configPath} = setupDirs(t);
		t.deepEqual(getFirstRunSetupPaths(project), {global: configPath});
		writeFileSync(configPath, '{}');
		t.deepEqual(getFirstRunSetupPaths(project), {global: configPath});
		writeFileSync(configPath, '{broken');
		t.is(getFirstRunSetupPaths(project), undefined);
		writeFileSync(configPath, '{"nanocoder":{"maxTurns":3}}');
		t.is(getFirstRunSetupPaths(project), undefined);
	},
);

test.serial(
	'saving over a first-run placeholder keeps references and rejects subsequent writes',
	async t => {
		const {project, configPath} = setupDirs(t);
		writeFileSync(configPath, '{}');
		const detected = await detectFirstRunProviders(
			{GROQ_API_KEY: 'test-key-value'},
			new AbortController().signal,
			async () => unavailable,
		);
		const results = await Promise.allSettled([
			saveDetectedProviders(project, 'global', detected),
			saveDetectedProviders(project, 'global', detected),
		]);
		t.is(results.filter(result => result.status === 'fulfilled').length, 1);
		t.is(results.filter(result => result.status === 'rejected').length, 1);
		const saved = readFileSync(configPath, 'utf8');
		t.is(JSON.parse(saved).nanocoder.providers[0].apiKey, '${GROQ_API_KEY}');
		t.false(saved.includes('test-key-value'));
		t.false(existsSync(`${configPath}.setup.lock`));
	},
);
