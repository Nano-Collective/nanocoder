import type {Message, ToolCall} from '@/types/core';

const INTERNAL_WALKTHROUGH_PREFIX = '<nanocoder-internal-walkthrough>';

export interface WalkthroughLifecycle {
	required: boolean;
	written: boolean;
	fallbackAttempted: boolean;
}

export function createWalkthroughLifecycle(
	messages: Message[],
): WalkthroughLifecycle {
	let latestUserMessage: Message | undefined;
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role === 'user' && !isInternalWalkthroughMessage(message)) {
			latestUserMessage = message;
			break;
		}
	}
	return {
		required: latestUserMessage?.content.includes('<approved_plan>') ?? false,
		written: false,
		fallbackAttempted: false,
	};
}

export function observeSuccessfulLifecycleTool(
	lifecycle: WalkthroughLifecycle,
	toolCall: ToolCall,
): void {
	if (toolCall.function.name === 'write_walkthrough') {
		lifecycle.written = true;
		return;
	}

	if (
		toolCall.function.name === 'write_tasks' &&
		Array.isArray(toolCall.function.arguments.tasks) &&
		toolCall.function.arguments.tasks.length > 0
	) {
		lifecycle.required = true;
	}
}

export function takeWalkthroughFallback(
	lifecycle: WalkthroughLifecycle,
	toolAvailable: boolean,
): Message | null {
	if (
		!toolAvailable ||
		!lifecycle.required ||
		lifecycle.written ||
		lifecycle.fallbackAttempted
	) {
		return null;
	}

	lifecycle.fallbackAttempted = true;
	return {
		role: 'user',
		content:
			`${INTERNAL_WALKTHROUGH_PREFIX}\n` +
			'Before ending this complex implementation, call write_walkthrough with the files actually changed, tests actually run, and verification steps. ' +
			'After saving it, reply with only a concise confirmation and do not repeat your previous answer.\n' +
			'</nanocoder-internal-walkthrough>',
	};
}

export function isInternalWalkthroughMessage(message: Message): boolean {
	return (
		message.role === 'user' &&
		message.content.startsWith(INTERNAL_WALKTHROUGH_PREFIX)
	);
}
