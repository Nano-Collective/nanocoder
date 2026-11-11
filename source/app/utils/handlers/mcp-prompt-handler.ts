import {getToolManager} from '@/message-handler';
import type {Message} from '@/types/core';
import type {CommandCompletion, MessageSubmissionOptions} from '@/types/index';
import {errorMsg, warningMsg} from '@/utils/message-factory';

/**
 * Dispatches `/mcp:<server>:<prompt>` — an MCP prompt invoked as a slash
 * command. Unlike a custom command's static template, an MCP prompt is
 * filled in by the server itself: this fetches it fresh on every call and
 * feeds the result to the model as the next chat turn, the same way a
 * custom command's rendered body does.
 *
 * Returns how the command completes when `commandName` matched a connected
 * server's prompt (success or reported error), or `undefined` when it is not
 * an MCP prompt.
 */
export async function handleMCPPromptCommand(
	commandName: string,
	args: string[],
	options: MessageSubmissionOptions,
): Promise<CommandCompletion | undefined> {
	const {onAddToChatQueue, onHandleChatMessage, messages, setMessages} =
		options;

	const toolManager = getToolManager();
	const mcpClient = toolManager?.getMCPClient();
	if (!mcpClient) return undefined;

	const prompt = mcpClient
		.getAllPrompts()
		.find(p => `mcp:${p.serverName}:${p.name}` === commandName);
	if (!prompt) return undefined;

	const declaredArgs = prompt.arguments ?? [];
	const promptArgs: Record<string, string> = {};
	const missing: string[] = [];
	declaredArgs.forEach((arg, index) => {
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
		return 'done-after-render';
	}

	// Args are filled in positionally, in the order the server declares them
	// (see docs/configuration/mcp-configuration.md). Anything beyond that -
	// including every arg typed when the prompt declares none at all - has
	// nowhere to go and would otherwise vanish with no indication why.
	if (args.length > declaredArgs.length) {
		const extra = args.slice(declaredArgs.length);
		onAddToChatQueue(
			warningMsg(
				declaredArgs.length === 0
					? `/${commandName} takes no arguments; ignoring: ${extra.join(', ')}`
					: `/${commandName} takes ${declaredArgs.length} argument${declaredArgs.length === 1 ? '' : 's'}; ignoring extra: ${extra.join(', ')}`,
				'mcp-prompt-warning',
			),
		);
	}

	try {
		const result = await mcpClient.getPrompt(
			prompt.serverName,
			prompt.name,
			promptArgs,
		);
		// Keep each message's own role instead of joining every message's text
		// into one blob - a few-shot prompt's assistant turns are structure the
		// model relies on, not just extra text to prepend.
		const textEntries = result.messages
			.map(m => ({role: m.role, text: contentToText(m.content)}))
			.filter(m => m.text.trim().length > 0);

		if (textEntries.length === 0) {
			onAddToChatQueue(
				errorMsg(
					`MCP prompt "/${commandName}" returned no text content.`,
					'mcp-prompt-error',
				),
			);
			return 'done-after-render';
		}

		const last = textEntries[textEntries.length - 1];
		const priorMessages: Message[] = textEntries
			.slice(0, -1)
			.map(m => ({role: m.role, content: m.text}));

		if (last.role === 'user') {
			// The common shape: any earlier turns (e.g. few-shot examples) are
			// spliced into history as-is, and only the final user turn triggers
			// the actual chat round-trip.
			await onHandleChatMessage(
				last.text,
				undefined,
				undefined,
				priorMessages.length > 0 ? priorMessages : undefined,
			);
			// The chat turn completes the command.
			return 'handed-off';
		}
		// The prompt doesn't end on a user turn - e.g. it seeds a scripted
		// assistant reply with nothing left to respond to. There is no
		// "next chat message" to submit, so append every turn as inert
		// history instead of fabricating a user message out of it.
		setMessages([
			...messages,
			...textEntries.map(m => ({role: m.role, content: m.text}) as Message),
		]);
		return 'done';
	} catch (error) {
		onAddToChatQueue(
			errorMsg(
				`Failed to load MCP prompt "/${commandName}": ${
					error instanceof Error ? error.message : String(error)
				}`,
				'mcp-prompt-error',
			),
		);
		return 'done-after-render';
	}
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
