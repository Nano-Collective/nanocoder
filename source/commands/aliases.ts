/**
 * Old command names that were folded into another command. Each one keeps
 * working (the dispatcher rewrites it to its target before routing), but is
 * not registered as a command of its own, so it stays out of `/help` and the
 * slash menu. `/help <old name>` still finds the command it now points to.
 *
 * `/resume`'s `/sessions` and `/history` predate this table and are routed by
 * the resume handler directly.
 */
export interface CommandAlias {
	/** The old command name, without the leading slash. */
	name: string;
	/** The command it now runs. */
	target: string;
	/** Arguments inserted before the user's own, e.g. a subcommand. */
	args?: readonly string[];
}

export const COMMAND_ALIASES: readonly CommandAlias[] = [
	{name: 'quit', target: 'exit'},
	{name: 'remember', target: 'memory', args: ['add']},
	{name: 'codex-login', target: 'login', args: ['codex']},
	{name: 'copilot-login', target: 'login', args: ['copilot']},
	{name: 'model-database', target: 'model', args: ['browse']},
	{name: 'schedule', target: 'skills', args: ['schedule']},
];

const ALIASES_BY_NAME = new Map(
	COMMAND_ALIASES.map(alias => [alias.name, alias]),
);

export function findCommandAlias(name: string): CommandAlias | undefined {
	return ALIASES_BY_NAME.get(name);
}

/** Aliases that point at `target`, for listing on its `/help` page. */
export function getAliasesFor(target: string): CommandAlias[] {
	return COMMAND_ALIASES.filter(alias => alias.target === target);
}

/**
 * Rewrite a slash command that uses an old name into its current form,
 * keeping everything after the name byte-for-byte: `/remember -c todo x`
 * becomes `/memory add -c todo x`. Anything that isn't an alias is returned
 * unchanged.
 */
export function expandCommandAlias(message: string): string {
	const match = /^\/(\S+)([\s\S]*)$/.exec(message);
	if (!match) return message;
	const alias = findCommandAlias(match[1]);
	if (!alias) return message;
	const prefix = [alias.target, ...(alias.args ?? [])].join(' ');
	return `/${prefix}${match[2]}`;
}

/**
 * Old names whose replacement is a different kind of command, so a silent
 * rewrite would confuse: each runs its target with `args` (the user's own
 * arguments are dropped) after a notice saying where it moved. Unlike
 * `COMMAND_ALIASES`, these never complete in the slash menu and `/help` does
 * not resolve them.
 */
interface RetiredCommand {
	name: string;
	target: string;
	args: readonly string[];
	notice: string;
}

function retiredSetupCommand(name: string, tab: string): RetiredCommand {
	return {
		name,
		target: 'settings',
		args: [tab],
		notice: `/${name} has moved to /settings — opening the ${tab} tab. Use /settings ${tab} next time.`,
	};
}

const RETIRED_COMMANDS: readonly RetiredCommand[] = [
	retiredSetupCommand('setup-providers', 'providers'),
	retiredSetupCommand('setup-mcp', 'mcp'),
];

export function findRetiredCommand(name: string): RetiredCommand | undefined {
	return RETIRED_COMMANDS.find(command => command.name === name);
}
