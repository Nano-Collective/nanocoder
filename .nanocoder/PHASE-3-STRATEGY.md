# Phase 3 Migration Strategy

## Analysis

### Current Format (OpenAI-compatible)

```typescript
interface Message {
	role: 'user' | 'assistant' | 'system' | 'tool';
	content: string;
	tool_calls?: ToolCall[]; // OpenAI format
	tool_call_id?: string; // For tool role
	name?: string; // Tool name
}
```

### AI SDK CoreMessage Format

```typescript
// System/User messages: { role: 'system'|'user', content: string }
// Assistant: { role: 'assistant', content: string }
// Tool: { role: 'tool', content: [{ type: 'tool-result', toolCallId, toolName, result }] }
```

### Key Differences

1. **Tool messages**: AI SDK uses `content` array with structured tool-result objects
2. **Tool calls**: AI SDK returns `toolCalls` from generateText(), not in message
3. **Field names**: `toolCallId` (AI SDK) vs `tool_call_id` (OpenAI), `toolName` vs `name`

## Migration Strategy

### Option A: Keep Converting (Current Approach - REJECTED)

- Continue using `convertMessagesToAISDK()`
- Convert tool messages to user messages
- **Problem**: Not leveraging AI SDK properly, losing type safety

### Option B: Dual Format (CHOSEN)

- Keep custom `Message` type for internal use (UI, storage, compatibility)
- Convert to `CoreMessage` only at AI SDK boundary (ai-sdk-client.ts)
- Use proper `CoreToolMessage` format in conversion
- **Benefits**: Minimal disruption, proper AI SDK usage, maintains compatibility

### Option C: Full Migration (Too Disruptive)

- Replace `Message` with `CoreMessage` everywhere
- Update all hooks, components, utilities
- **Problem**: Massive refactor, breaks existing code, complex tool message handling in UI

## Implementation Plan (Option B)

### Step 1: Update Type Definitions

- Add `CoreMessage` type alias
- Keep `Message` interface for backward compatibility
- Add conversion utility functions

### Step 2: Update AI SDK Client

- Remove simple `convertMessagesToAISDK()`
- Add proper `convertToCoreMessages()` that handles tool messages correctly
- Use AI SDK's tool message format: `{ role: 'tool', content: [{ type: 'tool-result', ... }] }`

### Step 3: Update Response Handling

- Extract tool calls from `result.toolCalls`
- Convert to our `ToolCall` format for internal use
- Store in `Message` format for conversation history

### Step 4: Test Thoroughly

- Test tool calling flow end-to-end
- Verify multi-turn conversations work
- Check tool result formatting

## Conversion Functions Needed

```typescript
// Convert our Message[] to CoreMessage[]
function convertToCoreMessages(messages: Message[]): CoreMessage[];

// Convert AI SDK toolCalls to our ToolCall format
function convertToolCalls(aiToolCalls): ToolCall[];

// Create tool result message in our format
function createToolResultMessage(toolCallId, toolName, result): Message;
```

## Why This Approach?

1. **Minimal Disruption**: Only changes ai-sdk-client.ts boundary
2. **Type Safety**: Proper CoreMessage usage with AI SDK
3. **Compatibility**: UI and storage continue using familiar format
4. **Future-Proof**: Easy to migrate fully to CoreMessage later if needed
5. **Proper Tool Handling**: Uses AI SDK's intended tool message format

## Files to Modify

1. `source/types/core.ts` - Add CoreMessage type alias and conversion utilities
2. `source/ai-sdk-client.ts` - Update conversion function, use proper tool format
3. Tests - Verify tool calling works correctly

## Files NOT to Modify (for now)

- Hooks (useAppState, useChatHandler, useToolHandler) - keep using Message
- Components - keep using Message
- Message handler - keep using Message
- Utilities - keep using Message

This keeps Phase 3 focused and manageable!
