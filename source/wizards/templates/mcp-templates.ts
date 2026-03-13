import {TIMEOUT_MCP_DEFAULT_MS} from '@/constants';
import type {TemplateField} from './provider-templates';

export type McpTransportType = 'stdio' | 'websocket' | 'http';

export interface McpServerConfig {
	name: string;
	transport: McpTransportType;

	// STDIO-specific
	command?: string;
	args?: string[];
	env?: Record<string, string>;

	// Remote transport-specific
	url?: string;
	headers?: Record<string, string>;
	auth?: {
		type: 'bearer' | 'basic' | 'api-key' | 'custom';
		token?: string;
		username?: string;
		password?: string;
		apiKey?: string;
		customHeaders?: Record<string, string>;
	};
	timeout?: number;

	// Common
	alwaysAllow?: string[];
	description?: string;
	tags?: string[];
	enabled?: boolean;
}

export interface McpTemplate {
	id: string;
	name: string;
	description: string;
	command: string;
	fields: TemplateField[];
	buildConfig: (answers: Record<string, string>) => McpServerConfig;
	category?: 'local' | 'remote';
	transportType: McpTransportType;
}

export const MCP_TEMPLATES: McpTemplate[] = [
	{
		id: 'filesystem',
		name: 'Filesystem',
		description: 'Read/write files and directories',
		command: 'npx',
		fields: [
			{
				name: 'allowedDirs',
				prompt: 'Allowed directories (comma-separated paths)',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: 'filesystem',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: [
				'-y',
				'@modelcontextprotocol/server-filesystem',
				...answers.allowedDirs
					.split(',')
					.map(d => d.trim())
					.filter(Boolean),
			],
			description: 'Read/write files and directories',
			tags: ['filesystem', 'local'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'github',
		name: 'GitHub',
		description: 'Repository management and operations',
		command: 'npx',
		fields: [
			{
				name: 'githubToken',
				prompt: 'GitHub Personal Access Token (scopes: repo, read:org)',
				required: true,
				sensitive: true,
			},
		],
		buildConfig: answers => ({
			name: 'github',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-github'],
			env: {
				GITHUB_PERSONAL_ACCESS_TOKEN: answers.githubToken,
			},
			description: 'Repository management and operations',
			tags: ['github', 'git', 'repository', 'stdio'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'postgres',
		name: 'PostgreSQL',
		description: 'Database queries and management',
		command: 'npx',
		fields: [
			{
				name: 'connectionString',
				prompt: 'Connection string (postgresql://user:pass@host:port/db)',
				required: true,
				sensitive: true,
			},
		],
		buildConfig: answers => ({
			name: 'postgres',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-postgres'],
			env: {
				POSTGRES_CONNECTION_STRING: answers.connectionString,
			},
			description: 'Database queries and management',
			tags: ['database', 'postgres', 'sql'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'brave-search',
		name: 'Brave Search',
		description: 'Web search capabilities',
		command: 'npx',
		fields: [
			{
				name: 'braveApiKey',
				prompt: 'Brave Search API Key',
				required: true,
				sensitive: true,
			},
		],
		buildConfig: answers => ({
			name: 'brave-search',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-brave-search'],
			env: {
				BRAVE_API_KEY: answers.braveApiKey,
			},
			description: 'Web search capabilities',
			tags: ['search', 'web', 'brave'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'fetch',
		name: 'Fetch',
		description: 'HTTP requests and web scraping',
		command: 'uvx',
		fields: [
			{
				name: 'userAgent',
				prompt: 'User-Agent string (optional)',
				required: false,
				default: 'ModelContextProtocol/1.0',
			},
		],
		buildConfig: answers => {
			const args: string[] = ['mcp-server-fetch'];
			if (
				answers.userAgent &&
				answers.userAgent !== 'ModelContextProtocol/1.0'
			) {
				args.push(`--user-agent=${answers.userAgent}`);
			}
			const config: McpServerConfig = {
				name: 'fetch',
				transport: 'stdio' as McpTransportType,
				command: 'uvx',
				args,
				description: 'HTTP requests and web scraping',
				tags: ['http', 'scraping', 'fetch', 'stdio'],
			};
			return config;
		},
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'deepwiki',
		name: 'DeepWiki',
		description:
			'DeepWiki provides up-to-date documentation you can talk to, for every repo in the world.',
		command: '',
		fields: [
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
				default: 'deepwiki',
			},
			{
				name: 'url',
				prompt: 'Server URL',
				required: true,
				default: 'https://mcp.deepwiki.com/mcp',
			},
		],
		buildConfig: answers => ({
			name: answers.serverName || 'deepwiki',
			transport: 'http' as McpTransportType,
			url: answers.url || 'https://mcp.deepwiki.com/mcp',
			description:
				'DeepWiki provides up-to-date documentation you can talk to, for every repo in the world.',
			tags: ['remote', 'wiki', 'documentation', 'http'],
			timeout: TIMEOUT_MCP_DEFAULT_MS,
		}),
		category: 'remote',
		transportType: 'http',
	},
	{
		id: 'sequential-thinking',
		name: 'Sequential Thinking',
		description:
			'Dynamic and reflective problem-solving through thought sequences.',
		command: '',
		fields: [
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
				default: 'sequential-thinking',
			},
			{
				name: 'url',
				prompt: 'Server URL',
				required: true,
				default: 'https://remote.mcpservers.org/sequentialthinking/mcp',
			},
		],
		buildConfig: answers => ({
			name: answers.serverName || 'sequential-thinking',
			transport: 'http' as McpTransportType,
			url:
				answers.url || 'https://remote.mcpservers.org/sequentialthinking/mcp',
			description:
				'Dynamic and reflective problem-solving through thought sequences.',
			tags: ['remote', 'reasoning', 'analysis', 'http'],
			timeout: TIMEOUT_MCP_DEFAULT_MS,
		}),
		category: 'remote',
		transportType: 'http',
	},
	{
		id: 'context7',
		name: 'Context7',
		description: 'Up-to-date code documentation for LLMs and AI code editors.',
		command: '',
		fields: [
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
				default: 'context7',
			},
			{
				name: 'url',
				prompt: 'Server URL',
				required: true,
				default: 'https://mcp.context7.com/mcp',
			},
		],
		buildConfig: answers => ({
			name: answers.serverName || 'context7',
			transport: 'http' as McpTransportType,
			url: answers.url || 'https://mcp.context7.com/mcp',
			description:
				'Up-to-date code documentation for LLMs and AI code editors.',
			tags: ['remote', 'context', 'information', 'http'],
			timeout: TIMEOUT_MCP_DEFAULT_MS,
		}),
		category: 'remote',
		transportType: 'http',
	},
	{
		id: 'remote-fetch',
		name: 'Fetch',
		description: 'Web content fetching and conversion for efficient LLM usage',
		command: '',
		fields: [
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
				default: 'remote-fetch',
			},
			{
				name: 'url',
				prompt: 'Server URL',
				required: true,
				default: 'https://remote.mcpservers.org/fetch/mcp',
			},
		],
		buildConfig: answers => ({
			name: answers.serverName || 'remote-fetch',
			transport: 'http' as McpTransportType,
			url: answers.url || 'https://remote.mcpservers.org/fetch/mcp',
			description:
				'Web content fetching and conversion for efficient LLM usage',
			tags: ['remote', 'http', 'scraping', 'fetch'],
			timeout: TIMEOUT_MCP_DEFAULT_MS,
		}),
		category: 'remote',
		transportType: 'http',
	},
	{
		id: 'github-remote',
		name: 'GitHub (Remote)',
		description:
			'Remote GitHub MCP server for repository management and operations',
		command: '',
		fields: [
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
				default: 'github-remote',
			},
			{
				name: 'githubToken',
				prompt: 'GitHub Personal Access Token (requires repo, read:org scopes)',
				required: true,
				sensitive: true,
			},
		],
		buildConfig: answers => ({
			name: answers.serverName || 'github-remote',
			transport: 'http' as McpTransportType,
			url: 'https://api.githubcopilot.com/mcp/',
			description:
				'Remote GitHub MCP server for repository management and operations',
			tags: ['remote', 'github', 'git', 'repository', 'http'],
			timeout: TIMEOUT_MCP_DEFAULT_MS,
			headers: {
				Authorization: `Bearer ${answers.githubToken}`,
			},
		}),
		category: 'remote',
		transportType: 'http',
	},
	{
		id: 'gitlab',
		name: 'GitLab',
		description: 'GitLab MCP server for repository management and operations',
		command: 'npx',
		fields: [
			{
				name: 'gitlabToken',
				prompt: 'GitLab Personal Access Token',
				required: true,
				sensitive: true,
			},
			{
				name: 'gitlabApiUrl',
				prompt: 'GitLab API URL (default: https://gitlab.com/api/v4)',
				required: false,
				default: 'https://gitlab.com/api/v4',
			},
		],
		buildConfig: answers => ({
			name: 'gitlab',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: ['-y', '@zereight/mcp-gitlab'],
			env: {
				GITLAB_PERSONAL_ACCESS_TOKEN: answers.gitlabToken,
				GITLAB_API_URL: answers.gitlabApiUrl || 'https://gitlab.com/api/v4',
			},
			description: 'GitLab MCP server for repository management and operations',
			tags: ['gitlab', 'git', 'repository', 'stdio'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'playwright',
		name: 'Playwright',
		description: 'Playwright MCP server for browser automation',
		command: 'npx',
		fields: [],
		buildConfig: _answers => ({
			name: 'playwright',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: ['@playwright/mcp@latest'],
			description: 'Playwright MCP server for browser automation',
			tags: ['playwright', 'browser', 'automation', 'stdio'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'chrome-devtools',
		name: 'Chrome DevTools',
		description: 'Chrome DevTools MCP server for browser automation',
		command: 'npx',
		fields: [
			{
				name: 'headless',
				prompt: 'Run Chrome in headless mode? (true/false)',
				required: false,
				default: 'true',
			},
		],
		buildConfig: answers => ({
			name: 'chrome-devtools',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: [
				'-y',
				'chrome-devtools-mcp@latest',
				...(answers.headless === 'true' ? ['--headless=true'] : []),
			],
			description: 'Chrome DevTools MCP server for browser automation',
			tags: ['chrome', 'devtools', 'browser', 'automation', 'stdio'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'duckduckgo',
		name: 'DuckDuckGo Search',
		description: 'DuckDuckGo search MCP server',
		command: 'uvx',
		fields: [],
		buildConfig: _answers => ({
			name: 'duckduckgo',
			transport: 'stdio' as McpTransportType,
			command: 'uvx',
			args: ['duckduckgo-mcp-server'],
			description: 'DuckDuckGo search MCP server',
			tags: ['duckduckgo', 'search', 'stdio'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'git',
		name: 'Git',
		description: 'Git MCP server for local repository operations',
		command: 'uvx',
		fields: [
			{
				name: 'repositoryPath',
				prompt: 'Path to Git repository',
				required: true,
			},
		],
		buildConfig: answers => ({
			name: 'git',
			transport: 'stdio' as McpTransportType,
			command: 'uvx',
			args: ['mcp-server-git', '--repository', answers.repositoryPath],
			description: 'Git MCP server for local repository operations',
			tags: ['git', 'repository', 'stdio'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'memory',
		name: 'Memory',
		description: 'Memory MCP server for persistent storage',
		command: 'npx',
		fields: [],
		buildConfig: _answers => ({
			name: 'memory',
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: ['-y', '@modelcontextprotocol/server-memory'],
			description: 'Memory MCP server for persistent storage',
			tags: ['memory', 'storage', 'stdio'],
		}),
		category: 'local',
		transportType: 'stdio',
	},
	{
		id: 'custom',
		name: 'Custom MCP Server',
		description: 'Custom MCP server configuration',
		command: '',
		fields: [
			{
				name: 'transport',
				prompt: 'Transport type (stdio, http, websocket)',
				required: true,
				default: 'stdio',
			},
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
			},
			{
				name: 'url',
				prompt: 'Server URL (for http/websocket transports)',
				required: false,
			},
			{
				name: 'command',
				prompt: 'Command (for stdio transport)',
				required: false,
			},
			{
				name: 'args',
				prompt: 'Arguments (space-separated, for stdio transport)',
				required: false,
			},
			{
				name: 'envVars',
				prompt: 'Environment variables (KEY=VALUE, one per line, optional)',
				required: false,
			},
		],
		buildConfig: answers => {
			const config: McpServerConfig = {
				name: answers.serverName,
				transport: (answers.transport || 'stdio') as McpTransportType,
				description: 'Custom MCP server configuration',
				tags: ['custom'],
			};

			// Configure based on transport type
			const transport = answers.transport || 'stdio';
			if (transport === 'stdio') {
				if (!answers.command) {
					throw new Error('Command is required for stdio transport');
				}
				config.command = answers.command;
				config.args = answers.args
					? answers.args
							.split(' ')
							.map(arg => arg.trim())
							.filter(Boolean)
					: [];
			} else if (transport === 'http' || transport === 'websocket') {
				if (!answers.url) {
					throw new Error('URL is required for http/websocket transports');
				}
				config.url = answers.url;
				config.timeout = TIMEOUT_MCP_DEFAULT_MS;
			}

			if (answers.envVars) {
				config.env = {};
				const lines = answers.envVars.split('\n');
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) continue;
					const [key, ...valueParts] = trimmed.split('=');
					if (key && valueParts.length > 0) {
						config.env[key.trim()] = valueParts.join('=').trim();
					}
				}
			}

			return config;
		},
		category: 'local', // Default to local, but can be remote based on transport
		transportType: 'stdio', // Default to stdio, but can be http/websocket based on transport
	},
];
