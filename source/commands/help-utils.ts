import type {Command} from '@/types/index';

export const HELP_CATEGORY_ORDER = [
	'Session & Workflow',
	'Model & Configuration',
	'Coding & Agent Tools',
	'System & Diagnostics',
	'Other',
] as const;

export type HelpCategory = (typeof HELP_CATEGORY_ORDER)[number];

export interface CommandHelpDetails {
	category: HelpCategory;
	usage: string;
	aliases?: readonly string[];
	options?: readonly string[];
	examples?: readonly string[];
}

type CommandHelpOverrides = Omit<CommandHelpDetails, 'category' | 'usage'> & {
	category?: HelpCategory;
	usage?: string;
};

const CATEGORY_COMMANDS: Record<HelpCategory, readonly string[]> = {
	'Session & Workflow': [
		'checkpoint',
		'clear',
		'compact',
		'commands',
		'copy',
		'expand',
		'export',
		'rename',
		'resume',
		'retry',
		'schedule',
		'tasks',
	],
	'Model & Configuration': [
		'codex-login',
		'context-max',
		'copilot-login',
		'init',
		'model',
		'model-database',
		'setup-config',
		'settings',
		'tune',
		'update',
	],
	'Coding & Agent Tools': [
		'agents',
		'commit',
		'explorer',
		'ide',
		'mcp',
		'memory',
		'remember',
		'repomap',
		'skills',
		'tools',
	],
	'System & Diagnostics': [
		'credits',
		'doctor',
		'exit',
		'help',
		'lsp',
		'privacy',
		'quit',
		'stats',
		'status',
		'tip',
		'usage',
	],
	Other: [],
};

const COMMAND_HELP_OVERRIDES: Record<string, CommandHelpOverrides> = {
	agents: {
		usage: '/agents [show <name>|copy <name>|create <name>]',
		options: ['show <name>', 'copy <name>', 'create <name>'],
		examples: ['/agents', '/agents show explore', '/agents copy explore'],
	},
	help: {
		category: 'System & Diagnostics',
		usage: '/help [command]',
		examples: ['/help', '/help commit'],
	},
	checkpoint: {
		usage:
			'/checkpoint <create|save|list|ls|load|restore|delete|remove|rm> [name]',
		options: [
			'create|save <name>',
			'list|ls',
			'load|restore <name>',
			'delete|remove|rm <name>',
		],
		examples: [
			'/checkpoint save before-refactor',
			'/checkpoint list',
			'/checkpoint load before-refactor',
		],
	},
	clear: {
		usage: '/clear',
		examples: ['/clear'],
	},
	compact: {
		usage:
			'/compact [--llm|--mechanical|--preview|--restore|--auto-on|--auto-off|--aggressive|--conservative|--default|--strategy <llm|mechanical>|--threshold <50-95>]',
		options: [
			'--llm',
			'--mechanical',
			'--strategy <llm|mechanical>',
			'--aggressive|--conservative|--default',
			'--preview',
			'--restore',
			'--auto-on',
			'--auto-off',
			'--threshold <50-95>',
		],
		examples: ['/compact --preview', '/compact --mechanical --threshold 80'],
	},
	commands: {
		usage: '/commands [show <name>|create <name>]',
		options: ['show <name>', 'create <name>'],
		examples: ['/commands', '/commands show review-code'],
	},
	commit: {
		usage: '/commit [--copy]',
		options: ['--copy'],
		examples: ['/commit', '/commit --copy'],
	},
	'context-max': {
		usage: '/context-max [length]|--reset',
		options: ['--reset'],
		examples: ['/context-max', '/context-max 128k', '/context-max --reset'],
	},
	copy: {
		usage: '/copy',
		examples: ['/copy'],
	},
	expand: {
		usage: '/expand [result-number]',
		examples: ['/expand', '/expand 2'],
	},
	export: {
		usage: '/export [filename]',
		examples: ['/export', '/export session.md'],
	},
	init: {
		usage: '/init [--preset <react|nextjs|rust>] [--force] [--lean]',
		options: ['--preset <react|nextjs|rust>', '--force', '--lean'],
		examples: ['/init', '/init --preset react', '/init --force --lean'],
	},
	model: {
		usage: '/model',
		examples: ['/model'],
	},
	memory: {
		usage: '/memory [list|ls|delete|rm <id>|clear|propose|accept <n>]',
		options: ['list|ls', 'delete|rm <id>', 'clear', 'propose', 'accept <n>'],
		examples: ['/memory', '/memory delete 12ab34cd', '/memory propose'],
	},
	remember: {
		usage: '/remember [--category <name>] <memory>',
		options: ['--category <name>'],
		examples: ['/remember --category architecture Use TypeScript'],
	},
	privacy: {
		usage: '/privacy',
		examples: ['/privacy'],
	},
	repomap: {
		usage: '/repomap [--tokens <n>]',
		options: ['--tokens <n>'],
		examples: ['/repomap --tokens 8000'],
	},
	resume: {
		usage: '/resume',
		aliases: ['sessions', 'history'],
		examples: ['/resume'],
	},
	retry: {
		usage: '/retry [--model <id>] [--provider <name>]',
		options: ['--model <id>', '--provider <name>'],
		examples: ['/retry', '/retry --model gpt-5'],
	},
	settings: {
		usage: '/settings [tab]',
		options: ['providers', 'mcp', 'theme', 'appearance'],
		examples: ['/settings', '/settings providers'],
	},
	skills: {
		usage:
			'/skills [show|create|check|promote|demote] <name> [--force] [--move]',
		options: [
			'show <name>',
			'create <name>',
			'check <name>',
			'promote <name> [--force] [--move]',
			'demote <name> [--force] [--move]',
		],
		examples: [
			'/skills',
			'/skills show pr-reviewer',
			'/skills check pr-reviewer',
			'/skills promote pr-reviewer --move',
		],
	},
	stats: {
		usage: '/stats [7d|3m|all-time|reset]',
		options: ['7d', '3m', 'all-time', 'reset'],
		examples: ['/stats 7d', '/stats reset'],
	},
	tasks: {
		usage: '/tasks [add <title>|remove|rm <number>|clear]',
		options: ['add <title>', 'remove|rm <number>', 'clear'],
		examples: ['/tasks', '/tasks add review pull request', '/tasks remove 2'],
	},
	tools: {
		usage: '/tools [create <name>]',
		options: ['create <name>'],
		examples: ['/tools', '/tools create kubectl-pods'],
	},
};

const CATEGORY_BY_COMMAND = new Map<string, HelpCategory>(
	Object.entries(CATEGORY_COMMANDS).flatMap(([category, names]) =>
		names.map(name => [name, category as HelpCategory]),
	),
);

export function getCommandHelpDetails(command: Command): CommandHelpDetails {
	const overrides = COMMAND_HELP_OVERRIDES[command.name];
	return {
		category: getCommandHelpCategory(command.name),
		usage: overrides?.usage ?? `/${command.name}`,
		...(overrides?.aliases ? {aliases: overrides.aliases} : {}),
		...(overrides?.options ? {options: overrides.options} : {}),
		...(overrides?.examples ? {examples: overrides.examples} : {}),
	};
}

function getCommandHelpCategory(commandName: string): HelpCategory {
	return (
		COMMAND_HELP_OVERRIDES[commandName]?.category ??
		CATEGORY_BY_COMMAND.get(commandName) ??
		'Other'
	);
}

export function findHelpCommand(
	commands: readonly Command[],
	requestedName: string,
): Command | undefined {
	const normalizedName = requestedName.trim().replace(/^\/+/, '').toLowerCase();
	if (!normalizedName) return undefined;

	return commands.find(command => {
		if (command.name.toLowerCase() === normalizedName) return true;
		return (
			COMMAND_HELP_OVERRIDES[command.name]?.aliases?.some(
				alias => alias.toLowerCase() === normalizedName,
			) ?? false
		);
	});
}

export interface HelpCommandGroup {
	category: HelpCategory;
	commands: Command[];
}

export function groupHelpCommands(
	commands: readonly Command[],
): HelpCommandGroup[] {
	const grouped = new Map<HelpCategory, Command[]>();

	for (const command of commands) {
		const category = getCommandHelpCategory(command.name);
		const categoryCommands = grouped.get(category) ?? [];
		categoryCommands.push(command);
		grouped.set(category, categoryCommands);
	}

	return HELP_CATEGORY_ORDER.flatMap(category => {
		const categoryCommands = grouped.get(category);
		if (!categoryCommands?.length) return [];
		return [
			{
				category,
				commands: [...categoryCommands].sort((a, b) =>
					a.name.localeCompare(b.name),
				),
			},
		];
	});
}
