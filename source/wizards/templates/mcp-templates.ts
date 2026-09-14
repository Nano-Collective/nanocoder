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
	timeout?: number;

	// Common
	alwaysAllow?: string[];
	description?: string;
	tags?: string[];
	enabled?: boolean;
	// Wizard bookkeeping: id of the template that built this server. Not
	// consumed at runtime — it lets the edit flow resolve a server back to
	// its template when the user renamed it via the serverName field, where
	// name-based matching no longer works.
	templateId?: string;
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

/**
 * Stdio MCP server (`npx -y <pkg>`) whose only config is a single credential
 * passed through one environment variable.
 */
function envVarStdioTemplate(opts: {
	id: string;
	name: string;
	description: string;
	packageName: string;
	field: TemplateField;
	envKey: string;
	tags: string[];
}): McpTemplate {
	return {
		id: opts.id,
		name: opts.name,
		description: opts.description,
		command: 'npx',
		fields: [opts.field],
		buildConfig: answers => ({
			name: opts.id,
			transport: 'stdio' as McpTransportType,
			command: 'npx',
			args: ['-y', opts.packageName],
			env: {[opts.envKey]: answers[opts.field.name]},
			description: opts.description,
			tags: opts.tags,
		}),
		category: 'local',
		transportType: 'stdio',
	};
}

/**
 * Stdio MCP server that takes no configuration — a fixed command + args.
 */
function simpleStdioTemplate(opts: {
	id: string;
	name: string;
	description: string;
	command: string;
	args: string[];
	tags: string[];
}): McpTemplate {
	return {
		id: opts.id,
		name: opts.name,
		description: opts.description,
		command: opts.command,
		fields: [],
		buildConfig: () => ({
			name: opts.id,
			transport: 'stdio' as McpTransportType,
			command: opts.command,
			args: [...opts.args],
			description: opts.description,
			tags: opts.tags,
		}),
		category: 'local',
		transportType: 'stdio',
	};
}

/**
 * Remote HTTP MCP server configured by name + URL (no auth header).
 */
function remoteHttpTemplate(opts: {
	id: string;
	name: string;
	description: string;
	defaultServerName: string;
	defaultUrl: string;
	tags: string[];
}): McpTemplate {
	return {
		id: opts.id,
		name: opts.name,
		description: opts.description,
		command: '',
		fields: [
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
				default: opts.defaultServerName,
			},
			{
				name: 'url',
				prompt: 'Server URL',
				required: true,
				default: opts.defaultUrl,
			},
		],
		buildConfig: answers => ({
			name: answers.serverName || opts.defaultServerName,
			transport: 'http' as McpTransportType,
			url: answers.url || opts.defaultUrl,
			description: opts.description,
			tags: opts.tags,
			timeout: TIMEOUT_MCP_DEFAULT_MS,
		}),
		category: 'remote',
		transportType: 'http',
	};
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
	envVarStdioTemplate({
		id: 'github',
		name: 'GitHub',
		description: 'Repository management and operations',
		packageName: '@modelcontextprotocol/server-github',
		field: {
			name: 'githubToken',
			prompt: 'GitHub Personal Access Token (scopes: repo, read:org)',
			required: true,
			sensitive: true,
		},
		envKey: 'GITHUB_PERSONAL_ACCESS_TOKEN',
		tags: ['github', 'git', 'repository', 'stdio'],
	}),
	envVarStdioTemplate({
		id: 'postgres',
		name: 'PostgreSQL',
		description: 'Database queries and management',
		packageName: '@modelcontextprotocol/server-postgres',
		field: {
			name: 'connectionString',
			prompt: 'Connection string (postgresql://user:pass@host:port/db)',
			required: true,
			sensitive: true,
		},
		envKey: 'POSTGRES_CONNECTION_STRING',
		tags: ['database', 'postgres', 'sql'],
	}),
	envVarStdioTemplate({
		id: 'brave-search',
		name: 'Brave Search',
		description: 'Web search capabilities',
		packageName: '@modelcontextprotocol/server-brave-search',
		field: {
			name: 'braveApiKey',
			prompt: 'Brave Search API Key',
			required: true,
			sensitive: true,
		},
		envKey: 'BRAVE_API_KEY',
		tags: ['search', 'web', 'brave'],
	}),
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
	remoteHttpTemplate({
		id: 'deepwiki',
		name: 'DeepWiki',
		description:
			'DeepWiki provides up-to-date documentation you can talk to, for every repo in the world.',
		defaultServerName: 'deepwiki',
		defaultUrl: 'https://mcp.deepwiki.com/mcp',
		tags: ['remote', 'wiki', 'documentation', 'http'],
	}),
	remoteHttpTemplate({
		id: 'context7',
		name: 'Context7',
		description: 'Up-to-date code documentation for LLMs and AI code editors.',
		defaultServerName: 'context7',
		defaultUrl: 'https://mcp.context7.com/mcp',
		tags: ['remote', 'context', 'information', 'http'],
	}),
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
		id: 'you',
		name: 'You.com',
		description:
			'You.com web search, URL reading, and research MCP server (leave the API key empty to use the keyless free profile)',
		command: '',
		fields: [
			{
				name: 'serverName',
				prompt: 'Server name',
				required: true,
				default: 'you',
			},
			{
				name: 'apiKey',
				prompt:
					'You.com API key (optional — leave empty for the keyless free profile)',
				required: false,
				sensitive: true,
			},
		],
		buildConfig: answers => {
			const apiKey = answers.apiKey?.trim();
			const config: McpServerConfig = {
				name: answers.serverName || 'you',
				transport: 'http' as McpTransportType,
				url: apiKey
					? 'https://api.you.com/mcp'
					: 'https://api.you.com/mcp?profile=free',
				description: 'You.com web search, URL reading, and research MCP server',
				tags: ['you', 'search', 'web', 'research', 'http'],
				timeout: TIMEOUT_MCP_DEFAULT_MS,
				// Stamp the origin template so the edit flow can resolve this
				// server back to the `you` template even under a custom name.
				templateId: 'you',
			};
			if (apiKey) {
				config.headers = {Authorization: `Bearer ${apiKey}`};
			}
			return config;
		},
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
	simpleStdioTemplate({
		id: 'playwright',
		name: 'Playwright',
		description: 'Playwright MCP server for browser automation',
		command: 'npx',
		args: ['@playwright/mcp@latest'],
		tags: ['playwright', 'browser', 'automation', 'stdio'],
	}),
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
	simpleStdioTemplate({
		id: 'duckduckgo',
		name: 'DuckDuckGo Search',
		description: 'DuckDuckGo search MCP server',
		command: 'uvx',
		args: ['duckduckgo-mcp-server'],
		tags: ['duckduckgo', 'search', 'stdio'],
	}),
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
	simpleStdioTemplate({
		id: 'memory',
		name: 'Memory',
		description: 'Memory MCP server for persistent storage',
		command: 'npx',
		args: ['-y', '@modelcontextprotocol/server-memory'],
		tags: ['memory', 'storage', 'stdio'],
	}),
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

/**
 * Resolve which wizard template a saved server came from, for the edit flow.
 *
 * Resolution order:
 * 1. `templateId` — stamped by the wizard when the config is built. This is
 *    the only signal that survives a custom `serverName` (e.g. `you-paid`),
 *    since name-based matching misses and would fall through to `custom`,
 *    whose buildConfig never writes headers — silently dropping the bearer
 *    token.
 * 2. `tags` — hand-edited files that kept them. A tag matches only if it
 *    equals a real template id AND the template's transport agrees with the
 *    saved server's; `github-remote` carries a `github` tag, but that id is
 *    the stdio GitHub server, and resolving an http server to it would
 *    rebuild the config with the wrong transport.
 * 3. Server name equal to a template id — covers default names.
 *
 * Returns undefined when nothing matches, so callers can fall back to the
 * `custom` template.
 */
export function resolveMcpTemplateId(
	config: Pick<McpServerConfig, 'name' | 'tags' | 'transport'> & {
		templateId?: string;
	},
): string | undefined {
	const matches = (id: string) => {
		const template = MCP_TEMPLATES.find(t => t.id === id);
		return Boolean(template && template.id !== 'custom');
	};
	const transportCompatible = (id: string) => {
		const template = MCP_TEMPLATES.find(t => t.id === id);
		return Boolean(template && template.transportType === config.transport);
	};
	if (config.templateId && matches(config.templateId)) {
		return config.templateId;
	}
	if (config.tags?.length) {
		const tag = config.tags.find(
			tag => matches(tag) && transportCompatible(tag),
		);
		if (tag) return tag;
	}
	if (matches(config.name) && transportCompatible(config.name)) {
		return config.name;
	}
	return undefined;
}
