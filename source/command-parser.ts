import type {ParsedCommand} from '@/types/index';

export function parseInput(input: string): ParsedCommand {
	const trimmed = input.trim();

	// Check for bash command (prefixed with !)
	if (trimmed.startsWith('!')) {
		const bashCommand = trimmed.slice(1);
		return {
			isCommand: false, // Not a regular command
			isBashCommand: true,
			bashCommand: bashCommand,
		};
	}

	// Check for regular command (prefixed with /)
	if (!trimmed.startsWith('/')) {
		return {isCommand: false};
	}

	const commandText = trimmed.slice(1);
	if (!commandText) {
		return {isCommand: true, command: '', args: [], fullCommand: ''};
	}

	const parts = commandText.split(/\s+/);
	const command = parts[0];

	// If the command part contains a slash, it's likely a file path, not a slash command!
	if (command.includes('/')) {
		return {isCommand: false};
	}

	const args = parts.slice(1);

	return {
		isCommand: true,
		command,
		args,
		fullCommand: commandText,
	};
}
