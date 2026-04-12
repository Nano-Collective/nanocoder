/**
 * Lazy registry of all built-in slash commands.
 *
 * Keeping this file flat and free of static command imports is how nanocoder
 * avoids loading all 31 command modules at startup. Each entry carries the
 * command's `name` and `description` inline (duplicated from the command
 * module so the picker can render without triggering the load), plus a
 * `load()` thunk that performs the dynamic import on first invocation.
 *
 * **When adding a new command:** add an entry here AND create the command
 * file under `source/commands/`. Keep the description in sync with the
 * module's own `description` field — they should match.
 */
import type {LazyCommand} from '@/types/commands';

export const lazyCommands: LazyCommand[] = [
	{
		name: 'help',
		description: 'Show available commands',
		load: () => import('@/commands/help').then(m => m.helpCommand),
	},
	{
		name: 'exit',
		description: 'Exit the application',
		load: () => import('@/commands/exit').then(m => m.exitCommand),
	},
	{
		name: 'quit',
		description: 'Quit the application',
		load: () => import('@/commands/exit').then(m => m.quitCommand),
	},
	{
		name: 'clear',
		description: 'Clear the chat history, model context, and tasks',
		load: () => import('@/commands/clear').then(m => m.clearCommand),
	},
	{
		name: 'compact',
		description:
			'Compress message history to reduce context usage (use --aggressive, --conservative, --preview, --restore, --auto-on, --auto-off, --threshold <n>)',
		load: () => import('@/commands/compact').then(m => m.compactCommand),
	},
	{
		name: 'codex-login',
		description:
			'Log in to ChatGPT/Codex (device flow). Saves credentials for the "ChatGPT" provider.',
		load: () =>
			import('@/commands/codex-login-command').then(m => m.codexLoginCommand),
	},
	{
		name: 'copilot-login',
		description:
			'Log in to GitHub Copilot (device flow). Saves credentials for the "GitHub Copilot" provider.',
		load: () =>
			import('@/commands/copilot-login-command').then(
				m => m.copilotLoginCommand,
			),
	},
	{
		name: 'context-max',
		description:
			'Set maximum context length for this session (e.g. /context-max 128k, --reset to clear)',
		load: () => import('@/commands/context-max').then(m => m.contextMaxCommand),
	},
	{
		name: 'model',
		description: 'Select a model for the current provider',
		load: () => import('@/commands/model').then(m => m.modelCommand),
	},
	{
		name: 'provider',
		description: 'Switch between AI providers',
		load: () => import('@/commands/provider').then(m => m.providerCommand),
	},
	{
		name: 'commands',
		description:
			'List all custom commands. Subcommands: show <name>, refresh, create <name>',
		load: () =>
			import('@/commands/custom-commands').then(m => m.commandsCommand),
	},
	{
		name: 'lsp',
		description: 'Show connected LSP servers and their status',
		load: () => import('@/commands/lsp').then(m => m.lspCommand),
	},
	{
		name: 'mcp',
		description: 'Show connected MCP servers and their tools',
		load: () => import('@/commands/mcp').then(m => m.mcpCommand),
	},
	{
		name: 'init',
		description:
			'Initialize nanocoder configuration and analyze project structure. Use --force to regenerate AGENTS.md.',
		load: () => import('@/commands/init').then(m => m.initCommand),
	},
	{
		name: 'explorer',
		description: 'Browse project files and add to context',
		load: () => import('@/commands/explorer').then(m => m.explorerCommand),
	},
	{
		name: 'ide',
		description: 'Connect to an IDE',
		load: () => import('@/commands/ide').then(m => m.ideCommand),
	},
	{
		name: 'export',
		description: 'Export the chat history to a markdown file',
		load: () => import('@/commands/export').then(m => m.exportCommand),
	},
	{
		name: 'update',
		description: 'Update Nanocoder to the latest version',
		load: () => import('@/commands/update').then(m => m.updateCommand),
	},
	{
		name: 'model-database',
		description: 'Browse coding models from OpenRouter',
		load: () =>
			import('@/commands/model-database').then(m => m.modelDatabaseCommand),
	},
	{
		name: 'status',
		description: 'Display current status (provider, model, theme)',
		load: () => import('@/commands/status').then(m => m.statusCommand),
	},
	{
		name: 'setup-config',
		description: 'Open a configuration file in your editor',
		load: () =>
			import('@/commands/setup-config').then(m => m.setupConfigCommand),
	},
	{
		name: 'setup-providers',
		description: 'Launch interactive configuration wizard',
		load: () =>
			import('@/commands/setup-providers').then(m => m.setupProvidersCommand),
	},
	{
		name: 'setup-mcp',
		description: 'Launch interactive MCP server configuration wizard',
		load: () => import('@/commands/setup-mcp').then(m => m.setupMcpCommand),
	},
	{
		name: 'usage',
		description: 'Display token usage statistics',
		load: () => import('@/commands/usage').then(m => m.usageCommand),
	},
	{
		name: 'checkpoint',
		description:
			'Manage conversation checkpoints - save and restore session snapshots',
		load: () => import('@/commands/checkpoint').then(m => m.checkpointCommand),
	},
	{
		name: 'resume',
		description:
			'List and resume previous chat sessions. Aliases: /sessions, /history',
		load: () => import('@/commands/resume').then(m => m.resumeCommand),
	},
	{
		name: 'tasks',
		description: 'Manage your task list',
		load: () => import('@/commands/tasks').then(m => m.tasksCommand),
	},
	{
		name: 'settings',
		description:
			'Configure UI settings (theme, shapes, branding, paste threshold)',
		load: () => import('@/commands/settings').then(m => m.settingsCommand),
	},
	{
		name: 'tune',
		description:
			'Tune model settings (parameters, tool profiles, prompt, compaction)',
		load: () => import('@/commands/tune').then(m => m.tuneCommand),
	},
	{
		name: 'schedule',
		description: 'Manage scheduled jobs',
		load: () => import('@/commands/schedule').then(m => m.scheduleCommand),
	},
	{
		name: 'agents',
		description:
			'List subagents. /agents show <name> for details, /agents copy <name> to customize',
		load: () => import('@/commands/agents').then(m => m.agentsCommand),
	},
	{
		name: 'credits',
		description: 'Show project contributors and dependencies',
		load: () => import('@/commands/credits').then(m => m.creditsCommand),
	},
];
