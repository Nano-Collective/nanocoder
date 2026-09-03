import {DELAY_COMMAND_COMPLETE_MS} from '@/constants';
import {getToolManager} from '@/message-handler';
import type {MessageSubmissionOptions} from '@/types/index';
import {errorMsg} from '@/utils/message-factory';

/**
 * Dispatches `/mcp:<server>:<prompt>` — an MCP prompt invoked as a slash
 * command. Unlike a custom command's static template, an MCP prompt is
 * filled in by the server itself: this fetches it fresh on every call and
 * feeds the result to the model as the next chat turn, the same way a
 * custom command's rendered body does.
 *
 * Returns true if `commandName` matched a connected server's prompt (handled
 * either way, success or reported error).
 */
export async function handleMCPPromptCommand(
	commandName: string,
	args: string[],
	options: MessageSubmissionOptions,
): Promise<boolean> {
	const {onAddToChatQueue, onCommandComplete, onHandleChatMessage} = options;

	const toolManager = getToolManager();
	const mcpClient = toolManager?.getMCPClient();
	if (!mcpClient) return false;

	const prompt = mcpClient
		.getAllPrompts()
		.find(p => `mcp:${p.serverName}:${p.name}` === commandName);
	if (!prompt) return false;

	const promptArgs: Record<string, string> = {};
	const missing: string[] = [];
	(prompt.arguments ?? []).forEach((arg, index) => {
		const value = args[index];
		if (value !== undefined && value !== '') {
			promptArgs[arg.name] = value;
		} else if (arg.required) {
			missing.push(arg.name);
		}
	});

	if (missing.length > 0) {
		onAddToChatQueue(
			errorMsg(
				`Missing required argument${missing.length === 1 ? '' : 's'} for /${commandName}: ${missing.join(', ')}`,
				'mcp-prompt-error',
			),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		return true;
	}

	try {
		const result = await mcpClient.getPrompt(
			prompt.serverName,
			prompt.name,
			promptArgs,
		);
		const promptText = result.messages
			.map(m => contentToText(m.content))
			.filter(Boolean)
			.join('\n\n');

		if (promptText.trim()) {
			await onHandleChatMessage(promptText);
		} else {
			onAddToChatQueue(
				errorMsg(
					`MCP prompt "/${commandName}" returned no text content.`,
					'mcp-prompt-error',
				),
			);
			setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
		}
	} catch (error) {
		onAddToChatQueue(
			errorMsg(
				`Failed to load MCP prompt "/${commandName}": ${
					error instanceof Error ? error.message : String(error)
				}`,
				'mcp-prompt-error',
			),
		);
		setTimeout(() => onCommandComplete?.(), DELAY_COMMAND_COMPLETE_MS);
	}

	return true;
}

/** Text content passes through; non-text blocks get a short, honest note. */
function contentToText(content: {
	type: 'text' | 'image' | 'resource';
	text?: string;
	mimeType?: string;
}): string {
	if (content.type === 'text') return content.text ?? '';
	return `[${content.type} content: ${content.mimeType ?? 'unknown type'}, not inlined]`;
}
