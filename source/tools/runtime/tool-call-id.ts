import {randomBytes} from 'node:crypto';

/**
 * Generates a unique, collision-resistant tool call ID.
 *
 * Used wherever a tool call needs an id the model didn't supply — the native
 * converter and both fallback parsers (XML / JSON). Random bytes (not a parse
 * index) so ids stay unique across separate parses of the same content.
 */
export function generateToolCallId(): string {
	return `tool_${Date.now()}_${randomBytes(8).toString('hex')}`;
}
