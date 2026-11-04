import {
	CustomCommandExecutor,
	expandCustomCommandPrompt,
} from '@/custom-commands/executor';
import type {CustomCommand} from '@/types/index';

/**
 * Reply for a built-in slash command that only the CLI or the client's own UI
 * can run, or null when `commandName` is not one. The VS Code extension keeps
 * wording that points at its sidebar; every other client gets neutral text.
 */
export function builtinCommandReply(
	commandName: string,
	vsCode: boolean,
	customCommands: CustomCommand[],
): string | null {
	if (commandName === 'help') {
		const customList = customCommands
			.map(
				c =>
					`- \`/${c.fullName}\` — ${c.metadata.description || 'custom command'}`,
			)
			.join('\n');
		return [
			vsCode
				? '**Available slash commands in VS Code GUI:**'
				: '**Available slash commands:**',
			'',
			'- `/clear` — Clear the current conversation',
			...(vsCode
				? [
						'- `/copy` — Copy the last assistant response',
						'- `/copy code` — Copy the last code block from the last response',
					]
				: []),
			'- `/help` — Show this help message',
			'',
			vsCode
				? '**Not available in VS Code GUI** (CLI-only):'
				: '**Not available in this client** (CLI-only):',
			'- `/init`, `/theme`, `/context-max`, `/compact`, `/usage`, and other interactive commands',
			'',
			customList ? `**Your custom commands:**\n${customList}` : '',
		]
			.filter(Boolean)
			.join('\n');
	}

	// `/copy` is normally intercepted by the VS Code webview before it reaches
	// us; any other client has no such handling.
	if (commandName === 'copy') {
		return vsCode
			? '`/copy` is handled by the chat view. Type it in the Nanocoder chat input (or press Ctrl+Alt+Shift+C / Cmd+Alt+Shift+C for the last code block).'
			: "`/copy` isn't available in this client.";
	}

	if (commandName === 'model' || commandName === 'provider') {
		return vsCode
			? `Use the ${commandName} selector in the chat header to switch ${commandName}s.`
			: `Use your client's ${commandName} selector.`;
	}

	if (commandName === 'settings') {
		return vsCode
			? 'Use the Settings tab in the Nanocoder sidebar (the gear icon in the view title bar, or `Nanocoder: Settings` in the Command Palette).'
			: "Use your client's settings.";
	}

	if (
		['init', 'theme', 'compact', 'context-max', 'usage'].includes(commandName)
	) {
		return vsCode
			? `The \`/${commandName}\` command is only available in the interactive CLI (\`nanocoder\` in a terminal). It is not supported in the VS Code GUI.`
			: `The \`/${commandName}\` command is only available in the interactive Nanocoder CLI (\`nanocoder\` in a terminal).`;
	}

	return null;
}

/**
 * Model text for a custom slash command. The typed line is not kept above
 * the body, and `{{args}}` is filled from what followed the command name.
 * Attachment sections go after the body so they never fill an argument.
 */
export function acpCustomCommandText(
	invocation: string,
	command: CustomCommand,
	sections: string[] = [],
): string {
	return [
		expandCustomCommandPrompt(command, invocation, new CustomCommandExecutor()),
		...sections,
	].join('\n\n');
}
