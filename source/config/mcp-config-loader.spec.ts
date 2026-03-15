import test from 'ava';
import {writeFileSync, mkdirSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import {loadAllMCPConfigs, loadGlobalMCPConfig, loadProjectMCPConfig, loadAllProviderConfigs, mergeMCPConfigs} from '@/config/mcp-config-loader';

test.beforeEach(t => {
	// Create a temporary directory for testing
	const testDir = join(tmpdir(), `nanocoder-test-${Date.now()}`);
	t.context.testDir = testDir;
	t.context.originalCwd = process.cwd();

	// Create the test directory
	mkdirSync(testDir, {recursive: true});

	// Change to the test directory
	process.chdir(testDir);
});

test.afterEach(t => {
	// Clean up the temporary directory
	rmSync(t.context.testDir as string, {recursive: true, force: true});

	// Restore original working directory
	process.chdir(t.context.originalCwd as string);
});

test('loadProjectMCPConfig - loads object format from .mcp.json', t => {
	const testDir = t.context.testDir as string;

	const config = {
		mcpServers: {
			'test-server': {
				transport: 'stdio',
				command: 'npx',
				args: ['test-server']
			},
			'another-server': {
				transport: 'http',
				url: 'http://localhost:8080'
			}
		}
	};

	writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

	const result = loadProjectMCPConfig();
	t.is(result.length, 2);
	t.is(result[0].server.name, 'test-server');
	t.is(result[0].server.transport, 'stdio');
	t.is(result[1].server.name, 'another-server');
	t.is(result[1].server.transport, 'http');
	t.is(result[0].source, 'project');
});

test('loadProjectMCPConfig - loads alwaysAllow from .mcp.json', t => {
	const testDir = t.context.testDir as string;

	const config = {
		mcpServers: {
			'filesystem': {
				transport: 'stdio',
				command: 'npx',
				args: ['-y', '@modelcontextprotocol/server-filesystem', '.'],
				alwaysAllow: ['list_directory', 'read_file']
			}
		}
	};

	writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

	const result = loadProjectMCPConfig();
	t.is(result.length, 1);
	t.deepEqual(result[0].server.alwaysAllow, ['list_directory', 'read_file']);
});

test('loadProjectMCPConfig - loads all supported fields from .mcp.json', t => {
	const testDir = t.context.testDir as string;

	const config = {
		mcpServers: {
			'full-server': {
				transport: 'http',
				url: 'https://example.com/mcp',
				headers: {'Authorization': 'Bearer token'},
				timeout: 45000,
				alwaysAllow: ['search'],
				description: 'A test server',
				tags: ['test', 'example'],
				enabled: true
			}
		}
	};

	writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

	const result = loadProjectMCPConfig();
	t.is(result.length, 1);
	const server = result[0].server;
	t.is(server.name, 'full-server');
	t.is(server.transport, 'http');
	t.is(server.url, 'https://example.com/mcp');
	t.deepEqual(server.headers, {'Authorization': 'Bearer token'});
	t.is(server.timeout, 45000);
	t.deepEqual(server.alwaysAllow, ['search']);
	t.is(server.description, 'A test server');
	t.deepEqual(server.tags, ['test', 'example']);
	t.is(server.enabled, true);
});

test('loadProjectMCPConfig - ignores array format', t => {
	const testDir = t.context.testDir as string;

	const config = {
		mcpServers: [
			{
				name: 'test-server',
				transport: 'stdio',
				command: 'npx',
				args: ['test-server']
			}
		]
	};

	writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

	const result = loadProjectMCPConfig();
	t.is(result.length, 0);
});

test('loadGlobalMCPConfig - loads from global .mcp.json', t => {
	const testDir = t.context.testDir as string;

	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = testDir;

		const config = {
			mcpServers: {
				'global-server': {
					transport: 'stdio',
					command: 'npx',
					args: ['global-server']
				}
			}
		};

		writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

		const result = loadGlobalMCPConfig();
		const testServer = result.find(server => server.server.name === 'global-server');
		t.truthy(testServer, 'Test server should be found');
		t.is(testServer?.server.name, 'global-server');
		t.is(testServer?.source, 'global');
	} finally {
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test('loadGlobalMCPConfig - does not load from agents.config.json', t => {
	const testDir = t.context.testDir as string;

	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = testDir;

		// Only place MCP servers in agents.config.json (no .mcp.json)
		const config = {
			nanocoder: {
				mcpServers: {
					'legacy-server': {
						transport: 'stdio',
						command: 'npx',
						args: ['legacy-server']
					}
				}
			}
		};

		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(config));

		const result = loadGlobalMCPConfig();
		const legacyServer = result.find(server => server.server.name === 'legacy-server');
		t.falsy(legacyServer, 'MCP servers in agents.config.json should no longer be loaded');
	} finally {
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test('mergeMCPConfigs - project configs override global configs', t => {
	const projectServers = [
		{
			server: {
				name: 'shared-server',
				transport: 'stdio',
				command: 'npx',
				args: ['project-version']
			},
			source: 'project' as const
		},
		{
			server: {
				name: 'project-only',
				transport: 'http',
				url: 'http://project-only:8080'
			},
			source: 'project' as const
		}
	];

	const globalServers = [
		{
			server: {
				name: 'shared-server',
				transport: 'stdio',
				command: 'npx',
				args: ['global-version']
			},
			source: 'global' as const
		},
		{
			server: {
				name: 'global-only',
				transport: 'websocket',
				url: 'ws://global-only:8080'
			},
			source: 'global' as const
		}
	];

	const result = mergeMCPConfigs(projectServers, globalServers);

	// Should have 3 servers (shared-server from project, project-only, global-only)
	t.is(result.length, 3);

	const sharedServer = result.find(s => s.server.name === 'shared-server');
	t.is(sharedServer?.server.args?.[0], 'project-version'); // Project version should win
	t.is(sharedServer?.source, 'project');

	const projectOnly = result.find(s => s.server.name === 'project-only');
	t.truthy(projectOnly);
	t.is(projectOnly?.source, 'project');

	const globalOnly = result.find(s => s.server.name === 'global-only');
	t.truthy(globalOnly);
	t.is(globalOnly?.source, 'global');
});

test('loadAllProviderConfigs - loads providers from project config', t => {
	const testDir = t.context.testDir as string;

	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		const projectConfig = {
			nanocoder: {
				providers: [
					{
						name: 'project-provider',
						baseUrl: 'http://project.example.com',
						apiKey: 'project-key',
						models: ['model-1']
					}
				]
			}
		};
		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(projectConfig));

		const result = loadAllProviderConfigs();
		const testProvider = result.find(provider => provider.name === 'project-provider');
		t.truthy(testProvider, 'Test provider should be found');
		t.is(testProvider?.name, 'project-provider');
	} finally {
		process.chdir(originalCwd);
	}
});

test('loadProjectMCPConfig - handles empty .mcp.json gracefully', t => {
	const testDir = t.context.testDir as string;

	writeFileSync(join(testDir, '.mcp.json'), '{}');

	const result = loadProjectMCPConfig();
	t.is(result.length, 0);
});

test('loadProjectMCPConfig - handles .mcp.json with empty mcpServers object', t => {
	const testDir = t.context.testDir as string;

	const config = { mcpServers: {} };
	writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

	const result = loadProjectMCPConfig();
	t.is(result.length, 0);
});
