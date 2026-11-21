import type {ImageAttachment, Message, ToolResult} from '@/types/core';
import {toToolMessage} from '../tools/runtime/external-content.js';

/**
 * Builder pattern for constructing message arrays.
 * Provides a fluent interface for adding messages without side effects.
 * This ensures messages are only added to state once, preventing duplication.
 */
export class MessageBuilder {
	private messages: Message[];

	constructor(initialMessages: Message[]) {
		this.messages = [...initialMessages];
	}

	/**
	 * Add an assistant message (with or without tool_calls).
	 */
	addAssistantMessage(msg: Message): this {
		if (msg.role !== 'assistant') {
			throw new Error(
				'addAssistantMessage requires a message with role "assistant"',
			);
		}
		this.messages.push(msg);
		return this;
	}

	/**
	 * Add tool result messages from tool execution.
	 *
	 * Every result goes through `toToolMessage`, so a result that came from
	 * outside the workspace is framed for the model and every other result is
	 * written through unchanged.
	 */
	addToolResults(results: ToolResult[]): this {
		const toolMessages: Message[] = results.map(result =>
			toToolMessage(result),
		);
		this.messages.push(...toolMessages);
		return this;
	}

	/**
	 * Add a user message, optionally with image attachments for multimodal turns.
	 */
	addUserMessage(content: string, images?: ImageAttachment[]): this {
		this.messages.push({
			role: 'user',
			content,
			...(images && images.length > 0 ? {images} : {}),
		});
		return this;
	}

	/**
	 * Add an error message as a user message (for model self-correction).
	 */
	addErrorMessage(errorContent: string): this {
		this.messages.push({
			role: 'user',
			content: errorContent,
		});
		return this;
	}

	/**
	 * Add an arbitrary message (use sparingly, prefer specific methods).
	 */
	addMessage(message: Message): this {
		this.messages.push(message);
		return this;
	}

	/**
	 * Build and return the final messages array.
	 */
	build(): Message[] {
		return this.messages;
	}

	/**
	 * Get the current length of the messages array.
	 */
	get length(): number {
		return this.messages.length;
	}

	/**
	 * Check if the builder has any messages.
	 */
	get isEmpty(): boolean {
		return this.messages.length === 0;
	}
}
