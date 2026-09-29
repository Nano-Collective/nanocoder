import {mkdirSync, rmSync, writeFileSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import test from 'ava';
import {
	collectMCPSecurityFindings,
	validateMCPConfigSecurity,
	validateProjectConfigSecurity,
} from '@/config/validation';
import type {MCPServerConfig} from '@/types/config';
import {setGlobalMessageQueue} from '@/utils/message-queue';

console.log(`\nvalidation.spec.ts`);

test('validateMCPConfigSecurity - warns about hardcoded credentials in env vars', t => {
	const mcpServers: MCPServerConfig[] = [
		{
			name: 'test-server',
			transport: 'stdio',
			command: 'npx',
			args: ['test'],
			env: {
				API_KEY: 'hardcoded-secret-key', // This should trigger a warning
				NORMAL_VAR: 'normal-value', // This should not trigger a warning
			},
		},
	];

	const findings = collectMCPSecurityFindings(mcpServers);
	t.is(findings.length, 1);
	t.true(findings[0].includes('test-server'));
	t.true(findings[0].includes('API_KEY'));
	t.notThrows(() => {
		validateMCPConfigSecurity(mcpServers);
	});
});

test('validateMCPConfigSecurity - warns about hardcoded headers', t => {
	const mcpServers: MCPServerConfig[] = [
		{
			name: 'header-server',
			transport: 'http',
			url: 'http://localhost:8080',
			headers: {
				Authorization: 'Bearer hardcoded-token', // This should trigger a warning
				'Content-Type': 'application/json', // This should not trigger a warning
			},
		},
	];

	const findings = collectMCPSecurityFindings(mcpServers);
	t.is(findings.length, 1);
	t.true(findings[0].includes('header-server'));
	t.true(findings[0].includes('Authorization'));
	t.notThrows(() => {
		validateMCPConfigSecurity(mcpServers);
	});
});

test('validateMCPConfigSecurity - does not warn for environment variable references', t => {
	const mcpServers: MCPServerConfig[] = [
		{
			name: 'env-server',
			transport: 'stdio',
			command: 'npx',
			args: ['test'],
			env: {
				API_KEY: '$API_KEY', // Environment variable reference - no warning
				TOKEN: '${TOKEN}', // Environment variable reference - no warning
			},
		},
	];

	t.deepEqual(collectMCPSecurityFindings(mcpServers), []);
});

test('validateMCPConfigSecurity - prefers rawEnv over substituted env', t => {
	// After substituteEnvVars, runtime env holds the literal secret. The
	// scanner must still see the raw "$MY_KEY" reference and stay silent.
	const mcpServers: MCPServerConfig[] = [
		{
			name: 'substituted-server',
			transport: 'stdio',
			command: 'npx',
			env: {
				API_KEY: 'sk-live-secret-from-env',
			},
			rawEnv: {
				API_KEY: '$MY_REAL_KEY',
			},
		},
		{
			name: 'substituted-bad',
			transport: 'stdio',
			command: 'npx',
			env: {
				API_KEY: 'sk-live-secret-from-env',
			},
			rawEnv: {
				API_KEY: 'sk-hardcoded-literal',
			},
		},
	];

	const findings = collectMCPSecurityFindings(mcpServers);
	t.is(findings.length, 1);
	t.true(findings[0].includes('substituted-bad'));
});

test('validateProjectConfigSecurity - only validates project-level configs', t => {
	const mcpServers: MCPServerConfig[] = [
		{
			name: 'project-server',
			transport: 'stdio',
			command: 'npx',
			args: ['test'],
			env: {
				API_KEY: 'hardcoded-key', // Should trigger warning for project config
			},
			source: 'project', // Project-level config
		},
		{
			name: 'global-server',
			transport: 'stdio',
			command: 'npx',
			args: ['test'],
			env: {
				API_KEY: 'hardcoded-key', // Should NOT trigger warning for global config
			},
			source: 'global', // Global-level config
		},
	];

	const projectOnly = mcpServers.filter(s => s.source === 'project');
	t.deepEqual(
		collectMCPSecurityFindings(projectOnly).map(f =>
			f.includes('project-server') ? 'project-server' : 'other',
		),
		['project-server'],
	);
	t.notThrows(() => {
		validateProjectConfigSecurity(mcpServers);
	});
});

test('loader unwrap keeps source so project configs reach the validator', t => {
	// Mirrors MCPServerWithSource from mcp-config-loader: provenance lives on the wrapper.
	const wrapped = [
		{
			server: {
				name: 'project-server',
				transport: 'stdio' as const,
				command: 'npx',
				env: {API_KEY: 'hardcoded-key'},
			},
			source: 'project' as const,
		},
		{
			server: {
				name: 'global-server',
				transport: 'stdio' as const,
				command: 'npx',
				env: {API_KEY: 'hardcoded-key'},
			},
			source: 'global' as const,
		},
	];

	// Production path: loadAppConfig must copy wrapper.source onto the runtime object.
	const mcpServers = wrapped.map(item => ({
		...item.server,
		source: item.source,
	}));

	t.deepEqual(
		mcpServers.filter(server => server.source === 'project').map(s => s.name),
		['project-server'],
	);

	// Stripping the wrapper without copying source is the regression: the filter is empty.
	const stripped = wrapped.map(item => item.server);
	t.is(stripped.filter(server => server.source === 'project').length, 0);

	t.notThrows(() => {
		validateProjectConfigSecurity(mcpServers);
	});
});

test('collectMCPSecurityFindings - ignores non-string and non-credential values', t => {
	const mcpServers: MCPServerConfig[] = [
		{
			name: 'mixed',
			transport: 'stdio',
			command: 'npx',
			// biome-ignore lint/suspicious/noExplicitAny: intentional non-string values
			env: {API_KEY: 123, SECRET: null, PATH: '/usr/bin'} as any,
			// biome-ignore lint/suspicious/noExplicitAny: intentional non-string values
			headers: {Authorization: 42, Accept: 'application/json'} as any,
		},
		{
			name: 'empty',
			transport: 'stdio',
			command: 'npx',
			env: {},
			headers: {},
		},
	];

	t.deepEqual(collectMCPSecurityFindings(mcpServers), []);
});

test('validateMCPConfigSecurity - handles empty server list', t => {
	t.deepEqual(collectMCPSecurityFindings([]), []);
	t.notThrows(() => {
		validateMCPConfigSecurity([]);
		validateProjectConfigSecurity([]);
	});
});

// End-to-end through loadAppConfig: reverts of source/config/index.ts must
// fail this test (source dropped → empty project filter; env substituted
// before the scanner → false positives).
test.serial(
	'reloadAppConfig preserves MCP source and validates pre-substitution credentials',
	async t => {
		const {getAppConfig, reloadAppConfig, clearAppConfig} = await import(
			'./index.js'
		);

		const originalCwd = process.cwd();
		const originalEnv = process.env.NANOCODER_CONFIG_DIR;
		const originalKey = process.env.MY_REAL_KEY;
		const testDir = join(tmpdir(), `nanocoder-mcp-sec-${Date.now()}`);
		const emptyConfigDir = join(testDir, 'empty-global');

		mkdirSync(testDir, {recursive: true});
		mkdirSync(emptyConfigDir, {recursive: true});

		try {
			process.env.MY_REAL_KEY = 'sk-live-secret-from-env';
			writeFileSync(
				join(testDir, '.mcp.json'),
				JSON.stringify({
					mcpServers: {
						'good-citizen': {
							transport: 'stdio',
							command: 'npx',
							env: {API_KEY: '$MY_REAL_KEY'},
						},
						'unset-var': {
							transport: 'stdio',
							command: 'npx',
							env: {API_KEY: '$NOT_SET_ANYWHERE'},
						},
						'actually-bad': {
							transport: 'stdio',
							command: 'npx',
							env: {API_KEY: 'sk-hardcoded-literal'},
						},
					},
				}),
				'utf-8',
			);

			process.chdir(testDir);
			process.env.NANOCODER_CONFIG_DIR = emptyConfigDir;
			clearAppConfig();
			reloadAppConfig();

			const config = getAppConfig();
			const servers = config.mcpServers ?? [];
			t.is(servers.length, 3);

			// Production unwrap must keep provenance on the runtime objects.
			for (const server of servers) {
				t.is(server.source, 'project', `${server.name} must keep source`);
			}

			const byName = new Map(servers.map(s => [s.name, s]));
			// Runtime values are substituted for the MCP client.
			t.is(
				byName.get('good-citizen')?.env?.API_KEY,
				'sk-live-secret-from-env',
			);
			// Raw copies keep the pre-substitution reference for the scanner.
			t.is(byName.get('good-citizen')?.rawEnv?.API_KEY, '$MY_REAL_KEY');

			const findings = collectMCPSecurityFindings(servers);
			t.is(findings.length, 1);
			t.true(
				findings[0].includes('actually-bad'),
				`only actually-bad should warn, got: ${findings.join(' | ')}`,
			);

			// Same path the app initialization hooks use.
			t.notThrows(() => {
				validateProjectConfigSecurity(servers);
			});
		} finally {
			process.chdir(originalCwd);
			if (originalEnv !== undefined) {
				process.env.NANOCODER_CONFIG_DIR = originalEnv;
			} else {
				delete process.env.NANOCODER_CONFIG_DIR;
			}
			if (originalKey !== undefined) {
				process.env.MY_REAL_KEY = originalKey;
			} else {
				delete process.env.MY_REAL_KEY;
			}
			clearAppConfig();
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);

// The scanner's findings are only useful if the app shows them: through the
// real load path, validateProjectConfigSecurity must post a warning for the
// project server's hardcoded key, and none for the same key from a
// non-project source.
test.serial(
	'reloadAppConfig + validateProjectConfigSecurity warns only for project servers',
	async t => {
		const {getAppConfig, reloadAppConfig, clearAppConfig} = await import(
			'./index.js'
		);

		const originalCwd = process.cwd();
		const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
		const originalEnvServers = process.env.NANOCODER_MCPSERVERS;
		const testDir = join(tmpdir(), `nanocoder-mcp-warn-${Date.now()}`);
		const emptyConfigDir = join(testDir, 'empty-global');
		mkdirSync(emptyConfigDir, {recursive: true});

		const server = (name: string) => ({
			name,
			transport: 'stdio',
			command: 'npx',
			env: {API_KEY: 'sk-hardcoded-literal'},
		});

		const warnings: string[] = [];
		setGlobalMessageQueue(component => {
			warnings.push((component as {props: {message: string}}).props.message);
		});

		try {
			writeFileSync(
				join(testDir, '.mcp.json'),
				JSON.stringify({mcpServers: {'project-bad': server('project-bad')}}),
				'utf-8',
			);
			process.env.NANOCODER_MCPSERVERS = JSON.stringify([server('env-bad')]);
			process.chdir(testDir);
			process.env.NANOCODER_CONFIG_DIR = emptyConfigDir;
			clearAppConfig();
			reloadAppConfig();

			const servers = getAppConfig().mcpServers ?? [];
			t.deepEqual(
				servers.map(s => [s.name, s.source]).sort(),
				[
					['env-bad', 'env'],
					['project-bad', 'project'],
				],
			);

			validateProjectConfigSecurity(servers);

			t.is(warnings.length, 1, `expected one warning, got: ${warnings.join(' | ')}`);
			t.true(warnings[0].includes('project-bad'));
		} finally {
			setGlobalMessageQueue(() => {});
			process.chdir(originalCwd);
			for (const [key, value] of [
				['NANOCODER_CONFIG_DIR', originalConfigDir],
				['NANOCODER_MCPSERVERS', originalEnvServers],
			] as const) {
				if (value !== undefined) {
					process.env[key] = value;
				} else {
					delete process.env[key];
				}
			}
			clearAppConfig();
			rmSync(testDir, {recursive: true, force: true});
		}
	},
);
