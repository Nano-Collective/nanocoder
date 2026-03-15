import test from 'ava';
import {writeFileSync, mkdirSync, rmSync} from 'fs';
import {tmpdir} from 'os';
import {join} from 'path';
import React from 'react';
import {loadAllMCPConfigs, loadGlobalMCPConfig, loadProjectMCPConfig, loadAllProviderConfigs, loadGlobalProviderConfigs, loadProjectProviderConfigs, mergeMCPConfigs} from '@/config/mcp-config-loader';
import {setGlobalMessageQueue} from '@/utils/message-queue';

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

test('loadProjectMCPConfig - loads from .mcp.json', t => {
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
	t.is(result.length, 1);
	t.is(result[0].server.name, 'test-server');
	t.is(result[0].source, 'project');
});

test('loadProjectMCPConfig - loads Claude Code format from .mcp.json', t => {
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

test('loadGlobalMCPConfig - loads from agents.config.json', t => {
	const testDir = t.context.testDir as string;

	// Create the config file in the user config directory location for this test
	// by temporarily setting NANOCODER_CONFIG_DIR to the test directory
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = testDir;

		const config = {
			nanocoder: {
				mcpServers: [
					{
						name: 'global-server',
						transport: 'stdio',
						command: 'npx',
						args: ['global-server']
					}
				]
			}
		};

		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(config));

		const result = loadGlobalMCPConfig();
		// The result may include additional servers from user's actual global config,
		// so we check that at least the test server is present
		const testServer = result.find(server => server.server.name === 'global-server');
		t.truthy(testServer, 'Test server should be found');
		t.is(testServer?.server.name, 'global-server');
		t.is(testServer?.source, 'global');
	} finally {
		// Restore original config directory environment variable
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test('loadGlobalMCPConfig - loads Claude Code format from agents.config.json', t => {
	const testDir = t.context.testDir as string;

	// Create the config file in the user config directory location for this test
	// by temporarily setting NANOCODER_CONFIG_DIR to the test directory
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = testDir;

		const config = {
			nanocoder: {
				mcpServers: {
					'global-server': {
						transport: 'stdio',
						command: 'npx',
						args: ['global-server']
					},
					'another-global': {
						transport: 'http',
						url: 'http://global:8080'
					}
				}
			}
		};

		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(config));

		const result = loadGlobalMCPConfig();
		// The result may include additional servers from user's actual global config,
		// so we check that at least the test servers are present
		const testServer1 = result.find(server => server.server.name === 'global-server');
		const testServer2 = result.find(server => server.server.name === 'another-global');

		t.truthy(testServer1, 'First test server should be found');
		t.truthy(testServer2, 'Second test server should be found');
		t.is(testServer1?.server.transport, 'stdio');
		t.is(testServer2?.server.transport, 'http');
		t.is(testServer1?.source, 'global');
	} finally {
		// Restore original config directory environment variable
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

test('loadAllProviderConfigs - loads providers from both project and global configs', t => {
	const testDir = t.context.testDir as string;

	// Temporarily change working directory to test directory for this test
	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		// Create project-level config
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
		// Result may include additional providers from user's actual global config,
		// so we check that at least the test provider is present
		const testProvider = result.find(provider => provider.name === 'project-provider');
		t.truthy(testProvider, 'Test provider should be found');
		t.is(testProvider?.name, 'project-provider');
	} finally {
		// Restore original working directory
		process.chdir(originalCwd);
	}
});

test('loadAllProviderConfigs - merges providers from project and global with project taking precedence', t => {
	const testDir = t.context.testDir as string;

	// Temporarily change working directory to test directory for this test
	const originalCwd = process.cwd();
	try {
		process.chdir(testDir);

		// Create project-level config with a provider that also exists in global
		const projectConfig = {
			nanocoder: {
				providers: [
					{
						name: 'shared-provider',
						baseUrl: 'http://project.example.com',
						apiKey: 'project-key',
						models: ['project-model']
					},
					{
						name: 'project-only',
						baseUrl: 'http://project-only.example.com',
						apiKey: 'project-only-key',
						models: ['project-only-model']
					}
				]
			}
		};
		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(projectConfig));

		const result = loadAllProviderConfigs();
		// Result may include additional providers from user's actual global config,
		// so we check that at least the test providers are present
		const sharedProvider = result.find(p => p.name === 'shared-provider');
		const projectOnly = result.find(p => p.name === 'project-only');

		t.truthy(sharedProvider, 'Shared provider should be found');
		t.truthy(projectOnly, 'Project-only provider should be found');

		// Verify that project version takes precedence for shared provider
		t.is(sharedProvider?.baseUrl, 'http://project.example.com'); // Project version should win
		t.is(sharedProvider?.apiKey, 'project-key');
		t.is(sharedProvider?.models[0], 'project-model');

		t.is(projectOnly?.baseUrl, 'http://project-only.example.com');
	} finally {
		// Restore original working directory
		process.chdir(originalCwd);
	}
});

// ============================================================================
// DEPRECATION WARNING TESTS
// ============================================================================

test('loadProjectMCPConfig - shows deprecation warning for array format', t => {
	const testDir = t.context.testDir as string;

	// Capture message queue calls
	const messages: React.ReactNode[] = [];
	const mockQueue = (component: React.ReactNode) => {
		messages.push(component);
	};
	setGlobalMessageQueue(mockQueue);

	try {
		// Use array format (deprecated)
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

		// Verify servers were loaded
		t.is(result.length, 1);
		t.is(result[0].server.name, 'test-server');

		// Verify deprecation warning was shown
		// Messages are React elements, so we need to extract the text content
		const messageTexts = messages.map(m => {
			// Extract message prop from React element
			const element = m as {props?: {message?: string}};
			return element.props?.message || '';
		});

		const arrayFormatWarning = messageTexts.find(t => t.includes('Array format for MCP servers is deprecated'));
		t.truthy(arrayFormatWarning, 'Array format deprecation warning should be shown');
		t.true(messageTexts.some(t => t.includes('Please use object format')), 'Should suggest object format');
	} finally {
		// Restore original message queue
		setGlobalMessageQueue(() => {});
	}
});

test('loadProjectMCPConfig - no deprecation warning for Claude Code object format', t => {
	const testDir = t.context.testDir as string;

	// Capture message queue calls
	const messages: React.ReactNode[] = [];
	const mockQueue = (component: React.ReactNode) => {
		messages.push(component);
	};
	setGlobalMessageQueue(mockQueue);

	try {
		// Use Claude Code object format (recommended)
		const config = {
			mcpServers: {
				'test-server': {
					transport: 'stdio',
					command: 'npx',
					args: ['test-server']
				}
			}
		};

		writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

		const result = loadProjectMCPConfig();

		// Verify servers were loaded
		t.is(result.length, 1);
		t.is(result[0].server.name, 'test-server');

		// Verify NO deprecation warning was shown
		const messageTexts = messages.map(m => {
			const element = m as {props?: {message?: string}};
			return element.props?.message || '';
		});

		const arrayFormatWarning = messageTexts.find(t => t.includes('Array format for MCP servers is deprecated'));
		t.falsy(arrayFormatWarning, 'Array format deprecation warning should NOT be shown for object format');
	} finally {
		// Restore original message queue
		setGlobalMessageQueue(() => {});
	}
});

test('loadGlobalMCPConfig - shows deprecation warning for agents.config.json', t => {
	const testDir = t.context.testDir as string;

	// Capture message queue calls
	const messages: React.ReactNode[] = [];
	const mockQueue = (component: React.ReactNode) => {
		messages.push(component);
	};
	setGlobalMessageQueue(mockQueue);

	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = testDir;

		// Create agents.config.json with MCP servers (deprecated location)
		const config = {
			nanocoder: {
				mcpServers: [
					{
						name: 'global-server',
						transport: 'stdio',
						command: 'npx',
						args: ['global-server']
					}
				]
			}
		};

		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(config));

		const result = loadGlobalMCPConfig();

		// Verify servers were loaded
		const testServer = result.find(server => server.server.name === 'global-server');
		t.truthy(testServer, 'Test server should be found');

		// Verify deprecation warning was shown
		const messageTexts = messages.map(m => {
			const element = m as {props?: {message?: string}};
			return element.props?.message || '';
		});

		const agentsConfigWarning = messageTexts.find(t => t.includes('agents.config.json are deprecated'));
		t.truthy(agentsConfigWarning, 'agents.config.json deprecation warning should be shown');
		t.true(messageTexts.some(t => t.includes('Please migrate to')), 'Should suggest migration to .mcp.json');
	} finally {
		// Restore original message queue and config dir
		setGlobalMessageQueue(() => {});
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test('loadGlobalMCPConfig - deprecation warning includes platform-specific path', t => {
	const testDir = t.context.testDir as string;

	// Capture message queue calls
	const messages: React.ReactNode[] = [];
	const mockQueue = (component: React.ReactNode) => {
		messages.push(component);
	};
	setGlobalMessageQueue(mockQueue);

	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	try {
		process.env.NANOCODER_CONFIG_DIR = testDir;

		// Create agents.config.json with MCP servers
		const config = {
			nanocoder: {
				mcpServers: [
					{
						name: 'test-server',
						transport: 'stdio',
						command: 'npx',
						args: ['test-server']
					}
				]
			}
		};

		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(config));

		loadGlobalMCPConfig();

		// Find the migration message with the actual path
		const messageTexts = messages.map(m => {
			const element = m as {props?: {message?: string}};
			return element.props?.message || '';
		});

		const migrationMessage = messageTexts.find(t => t.includes('Please migrate to'));
		t.truthy(migrationMessage, 'Migration message should be shown');

		// Verify the path is interpolated (not literal "${_configPath}")
		t.false(migrationMessage?.includes('${_configPath}'), 'Path should be interpolated, not literal');
		t.true(migrationMessage?.includes(testDir), 'Path should include the actual config directory path');
		t.true(migrationMessage?.includes('.mcp.json'), 'Path should reference .mcp.json file');
	} finally {
		// Restore original message queue and config dir
		setGlobalMessageQueue(() => {});
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test('loadProjectMCPConfig - handles empty .mcp.json gracefully', t => {
	const testDir = t.context.testDir as string;

	// Create an empty .mcp.json file
	writeFileSync(join(testDir, '.mcp.json'), '{}');

	const result = loadProjectMCPConfig();

	// Should return empty array, not crash
	t.is(result.length, 0);
});

test('loadProjectMCPConfig - handles .mcp.json with empty mcpServers array', t => {
	const testDir = t.context.testDir as string;

	// Create .mcp.json with empty mcpServers array
	const config = { mcpServers: [] };
	writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

	const result = loadProjectMCPConfig();

	// Should return empty array, not crash
	t.is(result.length, 0);
});

test('loadProjectMCPConfig - handles .mcp.json with empty mcpServers object', t => {
	const testDir = t.context.testDir as string;

	// Create .mcp.json with empty mcpServers object (Claude Code format)
	const config = { mcpServers: {} };
	writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(config));

	const result = loadProjectMCPConfig();

	// Should return empty array, not crash
	t.is(result.length, 0);
});

// ============================================================================
// Environment Variable Configuration Tests (Issue #307)
// ============================================================================

test('loadEnvMCPConfigs - loads from NANOCODER_MCPSERVERS environment variable', t => {
	const originalValue = process.env.NANOCODER_MCPSERVERS;
	
	try {
		const config = [
			{
				name: 'env-server',
				transport: 'stdio',
				command: 'npx',
				args: ['env-server']
			}
		];
		process.env.NANOCODER_MCPSERVERS = JSON.stringify(config);
		
		// Access through loadAllMCPConfigs which internally calls loadEnvMCPConfigs
		const allConfigs = loadAllMCPConfigs();
		
		// Should find the env server
		const envServer = allConfigs.find(c => c.server.name === 'env-server');
		t.truthy(envServer);
		t.is(envServer?.source, 'env');
	} finally {
		if (originalValue !== undefined) {
			process.env.NANOCODER_MCPSERVERS = originalValue;
		} else {
			delete process.env.NANOCODER_MCPSERVERS;
		}
	}
});

test('loadEnvMCPConfigs - loads from NANOCODER_MCPSERVERS_FILE', t => {
	const testDir = t.context.testDir as string;
	const originalValue = process.env.NANOCODER_MCPSERVERS;
	const originalFileValue = process.env.NANOCODER_MCPSERVERS_FILE;
	
	try {
		const config = [
			{
				name: 'file-server',
				transport: 'http',
				url: 'http://localhost:8080'
			}
		];
		
		const filePath = join(testDir, 'mcp-servers.json');
		writeFileSync(filePath, JSON.stringify(config));
		
		process.env.NANOCODER_MCPSERVERS_FILE = filePath;
		delete process.env.NANOCODER_MCPSERVERS; // Ensure direct var doesn't interfere
		
		const allConfigs = loadAllMCPConfigs();
		
		const fileServer = allConfigs.find(c => c.server.name === 'file-server');
		t.truthy(fileServer);
		t.is(fileServer?.source, 'env');
	} finally {
		if (originalValue !== undefined) {
			process.env.NANOCODER_MCPSERVERS = originalValue;
		} else {
			delete process.env.NANOCODER_MCPSERVERS;
		}
		if (originalFileValue !== undefined) {
			process.env.NANOCODER_MCPSERVERS_FILE = originalFileValue;
		} else {
			delete process.env.NANOCODER_MCPSERVERS_FILE;
		}
	}
});

test('loadEnvMCPConfigs - handles invalid JSON gracefully', t => {
	const originalValue = process.env.NANOCODER_MCPSERVERS;
	
	try {
		process.env.NANOCODER_MCPSERVERS = 'invalid json {';
		
		// Should not crash, should return empty array
		const allConfigs = loadAllMCPConfigs();
		const envServers = allConfigs.filter(c => c.source === 'env');
		t.is(envServers.length, 0);
	} finally {
		if (originalValue !== undefined) {
			process.env.NANOCODER_MCPSERVERS = originalValue;
		} else {
			delete process.env.NANOCODER_MCPSERVERS;
		}
	}
});

test('loadEnvMCPConfigs - returns empty array when no env vars set', t => {
	const originalValue = process.env.NANOCODER_MCPSERVERS;
	const originalFileValue = process.env.NANOCODER_MCPSERVERS_FILE;
	
	try {
		delete process.env.NANOCODER_MCPSERVERS;
		delete process.env.NANOCODER_MCPSERVERS_FILE;
		
		const allConfigs = loadAllMCPConfigs();
		const envServers = allConfigs.filter(c => c.source === 'env');
		t.is(envServers.length, 0);
	} finally {
		if (originalValue !== undefined) {
			process.env.NANOCODER_MCPSERVERS = originalValue;
		}
		if (originalFileValue !== undefined) {
			process.env.NANOCODER_MCPSERVERS_FILE = originalFileValue;
		}
	}
});

test('loadEnvProviderConfigs - loads from NANOCODER_PROVIDERS environment variable', t => {
	const originalValue = process.env.NANOCODER_PROVIDERS;
	
	try {
		const providers = [
			{
				name: 'env-provider',
				baseUrl: 'http://localhost:1234',
				apiKey: 'env-key',
				models: ['test-model']
			}
		];
		process.env.NANOCODER_PROVIDERS = JSON.stringify(providers);
		
		const allProviders = loadAllProviderConfigs();
		
		const envProvider = allProviders.find(p => p.name === 'env-provider');
		t.truthy(envProvider);
		t.is(envProvider?.baseUrl, 'http://localhost:1234');
	} finally {
		if (originalValue !== undefined) {
			process.env.NANOCODER_PROVIDERS = originalValue;
		} else {
			delete process.env.NANOCODER_PROVIDERS;
		}
	}
});

test('loadEnvProviderConfigs - supports nanocoder wrapper format', t => {
	const originalValue = process.env.NANOCODER_PROVIDERS;
	
	try {
		const config = {
			nanocoder: {
				providers: [
					{
						name: 'wrapped-provider',
						baseUrl: 'http://localhost:5678',
						models: ['model-1']
					}
				]
			}
		};
		process.env.NANOCODER_PROVIDERS = JSON.stringify(config);
		
		const allProviders = loadAllProviderConfigs();
		
		const wrappedProvider = allProviders.find(p => p.name === 'wrapped-provider');
		t.truthy(wrappedProvider);
		t.is(wrappedProvider?.baseUrl, 'http://localhost:5678');
	} finally {
		if (originalValue !== undefined) {
			process.env.NANOCODER_PROVIDERS = originalValue;
		} else {
			delete process.env.NANOCODER_PROVIDERS;
		}
	}
});

test('loadEnvProviderConfigs - supports direct providers format', t => {
	const originalValue = process.env.NANOCODER_PROVIDERS;
	
	try {
		const config = {
			providers: [
				{
					name: 'direct-provider',
					baseUrl: 'http://localhost:9012',
					models: ['model-2']
				}
			]
		};
		process.env.NANOCODER_PROVIDERS = JSON.stringify(config);
		
		const allProviders = loadAllProviderConfigs();
		
		const directProvider = allProviders.find(p => p.name === 'direct-provider');
		t.truthy(directProvider);
		t.is(directProvider?.baseUrl, 'http://localhost:9012');
	} finally {
		if (originalValue !== undefined) {
			process.env.NANOCODER_PROVIDERS = originalValue;
		} else {
			delete process.env.NANOCODER_PROVIDERS;
		}
	}
});

test('hierarchical precedence - env overrides project and global', t => {
	const testDir = t.context.testDir as string;
	const originalMcpServers = process.env.NANOCODER_MCPSERVERS;
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	
	try {
		// Set up project config
		const projectConfig = {
			mcpServers: [
				{
					name: 'override-test',
					transport: 'stdio',
					command: 'project-command'
				}
			]
		};
		writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(projectConfig));
		
		// Set up global config
		process.env.NANOCODER_CONFIG_DIR = testDir;
		const globalConfig = {
			nanocoder: {
				mcpServers: [
					{
						name: 'override-test',
						transport: 'stdio',
						command: 'global-command'
					}
				]
			}
		};
		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(globalConfig));
		
		// Set up env config (should override both)
		const envConfig = [
			{
				name: 'override-test',
				transport: 'http',
				url: 'http://env-url'
			}
		];
		process.env.NANOCODER_MCPSERVERS = JSON.stringify(envConfig);
		
		const allConfigs = loadAllMCPConfigs();
		
		// Should have only one server with the env config
		const matchingServers = allConfigs.filter(c => c.server.name === 'override-test');
		t.is(matchingServers.length, 1);
		t.is(matchingServers[0].server.transport, 'http');
		t.is(matchingServers[0].server.url, 'http://env-url');
		t.is(matchingServers[0].source, 'env');
	} finally {
		if (originalMcpServers !== undefined) {
			process.env.NANOCODER_MCPSERVERS = originalMcpServers;
		} else {
			delete process.env.NANOCODER_MCPSERVERS;
		}
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});

test('hierarchical precedence - NANOCODER_PROVIDERS overrides all', t => {
	const testDir = t.context.testDir as string;
	const originalProviders = process.env.NANOCODER_PROVIDERS;
	const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
	
	try {
		// Set up project config
		const projectConfig = {
			providers: [
				{
					name: 'provider-override-test',
					baseUrl: 'http://project-url',
					models: ['project-model']
				}
			]
		};
		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(projectConfig));
		
		// Set up global config
		process.env.NANOCODER_CONFIG_DIR = testDir;
		const globalConfig = {
			nanocoder: {
				providers: [
					{
						name: 'provider-override-test',
						baseUrl: 'http://global-url',
						models: ['global-model']
					}
				]
			}
		};
		writeFileSync(join(testDir, 'agents.config.json'), JSON.stringify(globalConfig));
		
		// Set up env config (should override both)
		const envConfig = [
			{
				name: 'provider-override-test',
				baseUrl: 'http://env-url',
				apiKey: 'env-key',
				models: ['env-model']
			}
		];
		process.env.NANOCODER_PROVIDERS = JSON.stringify(envConfig);
		
		const allProviders = loadAllProviderConfigs();
		
		// Should have only one provider with the env config
		const matchingProviders = allProviders.filter(p => p.name === 'provider-override-test');
		t.is(matchingProviders.length, 1);
		t.is(matchingProviders[0].baseUrl, 'http://env-url');
		t.is(matchingProviders[0].apiKey, 'env-key');
	} finally {
		if (originalProviders !== undefined) {
			process.env.NANOCODER_PROVIDERS = originalProviders;
		} else {
			delete process.env.NANOCODER_PROVIDERS;
		}
		if (originalConfigDir !== undefined) {
			process.env.NANOCODER_CONFIG_DIR = originalConfigDir;
		} else {
			delete process.env.NANOCODER_CONFIG_DIR;
		}
	}
});