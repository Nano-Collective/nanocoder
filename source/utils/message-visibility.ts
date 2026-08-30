import type {Message} from '@/types/index';

/**
 * True when a message belongs in the provider payload.
 *
 * `displayOnly` marks harness-authored chrome (cancellation notices, error
 * banners, replies to built-in slash commands) that renders in chat and
 * persists with session history but must never be handed to the model as its
 * own past output. Everything that isn't marked is model-facing.
 */
export function isModelFacing(message: Message): boolean {
	return !message.displayOnly;
}

/**
 * The model-facing subset of a conversation: what the provider actually sees,
 * and therefore what context-usage estimates and compaction should measure.
 */
export function filterModelFacing(messages: Message[]): Message[] {
	return messages.filter(isModelFacing);
}
