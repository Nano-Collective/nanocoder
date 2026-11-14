import {SETTINGS_TAB_IDS} from '@/app/components/settings-constants';
import {findCommandAlias, getAliasesFor} from '@/commands/aliases';
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
		'fork',
		'rename',
		'resume',
		'retry',
		'share',
		'tasks',
	],
	'Model & Configuration': [
		'context-max',
		'init',
		'login',
		'model',
		'setup-config',
		'settings',
		'tune',
		'update',
		'voice',
	],
	'Coding & Agent Tools': [
		'agents',
		'commit',
		'explorer',
		'firewall',
		'ide',
		'mcp',
		'memory',
		'repomap',
		'review',
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
	firewall: {
		usage:
			'/firewall [status|enable|disable|mode <strict|lenient|disabled>|toggle <any|tests|exports>|protect <pattern>|unprotect <pattern>|reset]',
		options: [
			'status',
			'enable|disable',
			'mode <strict|lenient|disabled>',
			'toggle <any|tests|exports>',
			'protect <pattern>',
			'unprotect <pattern>',
			'reset',
		],
		examples: [
			'/firewall',
			'/firewall mode lenient',
			'/firewall protect src/api/**',
			'/firewall toggle tests',
		],
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
			'create|save [name]',
			'list|ls',
			'load|restore [name]',
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
			'?threshold=<50-95> (this run only: skip if usage is below it)',
			'?context-max=<n> (this run only)',
			'?auto-compact=<on|off> (this run only)',
			'?preview, ?llm, ?mechanical, ?aggressive, ?conservative',
		],
		examples: [
			'/compact --preview',
			'/compact --mechanical --threshold 80',
			'/compact ?threshold=80',
		],
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
		usage: '/copy [code]',
		options: ['code'],
		examples: ['/copy', '/copy code'],
	},
	expand: {
		usage: '/expand [result-number]',
		examples: ['/expand', '/expand 2'],
	},
	export: {
		usage: '/export [--json] [filename]',
		options: ['--json'],
		examples: [
			'/export',
			'/export session.md',
			'/export --json',
			'/export run.json',
		],
	},
	fork: {
		usage: '/fork [title]',
		examples: ['/fork', '/fork try-the-other-approach'],
	},
	init: {
		usage: '/init [--preset <react|nextjs|rust>] [--force] [--lean]',
		options: ['--preset <react|nextjs|rust>', '--force', '--lean'],
		examples: ['/init', '/init --preset react', '/init --force --lean'],
	},
	login: {
		usage: '/login <codex|copilot> [provider name]',
		options: ['codex [provider name]', 'copilot [provider name]'],
		examples: ['/login codex', '/login copilot', '/login copilot Work Copilot'],
	},
	model: {
		usage: '/model [browse]',
		options: ['browse'],
		examples: ['/model', '/model browse'],
	},
	memory: {
		usage:
			'/memory [list|ls|add [--category <name>] <text>|delete|rm <id>|clear|propose|accept <n>]',
		options: [
			'list|ls',
			'add [--category|-c <name>] <text>',
			'delete|rm <id>',
			'clear',
			'propose',
			'accept <n>',
		],
		examples: [
			'/memory',
			'/memory add --category architecture Use TypeScript',
			'/memory delete 12ab34cd',
			'/memory propose',
		],
	},
	privacy: {
		usage: '/privacy inspect <text>',
		options: ['inspect <text>'],
		examples: ['/privacy inspect my email is test@example.com'],
	},
	repomap: {
		usage: '/repomap [--tokens <n>]',
		options: ['--tokens <n>'],
		examples: ['/repomap --tokens 8000'],
	},
	resume: {
		usage: '/resume',
		examples: ['/resume'],
	},
	review: {
		usage: '/review [quick] [<branch | PR number | GitHub PR URL>]',
		options: ['quick', '<branch>', '<PR number>', '<GitHub PR URL>'],
		examples: ['/review', '/review quick', '/review main', '/review 42'],
	},
	retry: {
		usage: '/retry [--model <id>] [--provider <name>]',
		options: ['--model <id>', '--provider <name>'],
		examples: ['/retry', '/retry --model gpt-5'],
	},
	settings: {
		usage: '/settings [tab]',
		options: SETTINGS_TAB_IDS,
		examples: ['/settings', '/settings providers'],
	},
	share: {
		usage: '/share [--json] [--no-redact] [filename]',
		options: ['--json', '--no-redact'],
		examples: [
			'/share',
			'/share notes/debug-session.html',
			'/share --json',
			'/share --no-redact',
		],
	},
	skills: {
		usage:
			'/skills [show|create|check|promote|demote <name> [--force] [--move]|schedule]',
		options: [
			'show <name>',
			'create <name>',
			'check <name>',
			'promote <name> [--force] [--move]',
			'demote <name> [--force] [--move]',
			'schedule (list cron-triggered skills)',
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
		usage:
			'/tasks [list|add <title>|start <number>|done|complete <number>|remove|rm <number>|clear]',
		options: [
			'list',
			'add <title>',
			'start <number>',
			'done|complete <number>',
			'remove|rm <number>',
			'clear',
		],
		examples: [
			'/tasks',
			'/tasks add review pull request',
			'/tasks start 1',
			'/tasks done 1',
			'/tasks remove 2',
		],
	},
	tools: {
		usage: '/tools [create <name>]',
		options: ['create <name>'],
		examples: ['/tools', '/tools create kubectl-pods'],
	},
	usage: {
		usage: '/usage [?context-max=<n>]',
		options: ['?context-max=<n> (this run only, e.g. 200k)'],
		examples: ['/usage', '/usage ?context-max=200k'],
	},
	voice: {
		usage:
			'/voice [on|off|status|hands-free|ptt|mode <push-to-talk|hands-free>|stt <local|cloud>|tts <local|cloud>]',
		options: [
			'on|off',
			'status',
			'hands-free',
			'ptt|push-to-talk',
			'mode <push-to-talk|hands-free>',
			'stt <local|cloud>',
			'tts <local|cloud>',
		],
		examples: ['/voice on', '/voice ptt', '/voice stt local'],
	},
};

const CATEGORY_BY_COMMAND = new Map<string, HelpCategory>(
	Object.entries(CATEGORY_COMMANDS).flatMap(([category, names]) =>
		names.map(name => [name, category as HelpCategory]),
	),
);

/**
 * Old names that now run this command (see `aliases.ts`), shown on its help
 * page. One that inserts a subcommand says so: `remember (= /memory add)`.
 */
function getCommandAliases(commandName: string): string[] {
	return [
		...getAliasesFor(commandName).map(alias =>
			alias.args?.length
				? `${alias.name} (= /${alias.target} ${alias.args.join(' ')})`
				: alias.name,
		),
	];
}

export function getCommandHelpDetails(command: Command): CommandHelpDetails {
	const overrides = COMMAND_HELP_OVERRIDES[command.name];
	const aliases = getCommandAliases(command.name);
	return {
		category: getCommandHelpCategory(command.name),
		usage: overrides?.usage ?? `/${command.name}`,
		...(aliases.length > 0 ? {aliases} : {}),
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

	// `/help remember` shows the command the old name now runs.
	const alias = findCommandAlias(normalizedName);
	if (alias) {
		return commands.find(command => command.name === alias.target);
	}

	return commands.find(
		command => command.name.toLowerCase() === normalizedName,
	);
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
		if (command.hidden) continue;
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
