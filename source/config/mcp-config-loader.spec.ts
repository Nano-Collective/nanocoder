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

test('loadEnvMCPConfigs - supports mcpServers wrapper format', t => {
    const originalValue = process.env.NANOCODER_MCPSERVERS;

    try {
        const config = {
            mcpServers: {
                'wrapped-server': {
                    transport: 'http',
                    url: 'http://localhost:9090'
                }
            }
        };
        process.env.NANOCODER_MCPSERVERS = JSON.stringify(config);

        const allConfigs = loadAllMCPConfigs();

        const wrappedServer = allConfigs.find(c => c.server.name === 'wrapped-server');
        t.truthy(wrappedServer);
        t.is(wrappedServer?.source, 'env');
        t.is(wrappedServer?.server.url, 'http://localhost:9090');
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
    const originalNodeEnv = process.env.NODE_ENV;

    try {
        // Enable global config loading for this test
        delete process.env.NODE_ENV;

        // Set up project config (object format as used by .mcp.json)
        const projectConfig = {
            mcpServers: {
                'override-test': {
                    transport: 'stdio',
                    command: 'project-command'
                }
            }
        };
        writeFileSync(join(testDir, '.mcp.json'), JSON.stringify(projectConfig));

        // Set up global config in a separate directory
        const globalDir = join(testDir, 'global-config');
        mkdirSync(globalDir, {recursive: true});
        process.env.NANOCODER_CONFIG_DIR = globalDir;
        const globalConfig = {
            mcpServers: {
                'override-test': {
                    transport: 'stdio',
                    command: 'global-command'
                }
            }
        };
        writeFileSync(join(globalDir, '.mcp.json'), JSON.stringify(globalConfig));

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
        if (originalNodeEnv !== undefined) {
            process.env.NODE_ENV = originalNodeEnv;
        } else {
            delete process.env.NODE_ENV;
        }
    }
});

test('hierarchical precedence - NANOCODER_PROVIDERS overrides all', t => {
    const testDir = t.context.testDir as string;
    const originalProviders = process.env.NANOCODER_PROVIDERS;
    const originalConfigDir = process.env.NANOCODER_CONFIG_DIR;
    const originalNodeEnv = process.env.NODE_ENV;

    try {
        // Enable global config loading for this test
        delete process.env.NODE_ENV;

        // Set up global config in a separate directory
        const globalDir = join(testDir, 'global-config');
        mkdirSync(globalDir, {recursive: true});
        process.env.NANOCODER_CONFIG_DIR = globalDir;
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
        writeFileSync(join(globalDir, 'agents.config.json'), JSON.stringify(globalConfig));

        // Set up project config in the working directory
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
        if (originalNodeEnv !== undefined) {
            process.env.NODE_ENV = originalNodeEnv;
        } else {
            delete process.env.NODE_ENV;
        }
    }
});