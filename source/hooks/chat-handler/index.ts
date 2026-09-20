/**
 * Chat handler module - manages LLM conversations and tool execution
 *
 * This module orchestrates the conversation flow between users and LLMs,
 * handling streaming responses, tool calls, and conversation state.
 */

// Types
export type {ChatHandlerReturn, UseChatHandlerProps} from './types';
// Main hook
export {useChatHandler} from './useChatHandler';
