# Phase 3: CoreMessage Integration - COMPLETE ✅

**Date:** October 31, 2025
**Status:** ✅ Complete

## Summary

Phase 3 of the AI SDK migration is now complete! This phase implemented proper `CoreMessage` usage at the AI SDK boundary while maintaining backward compatibility with our existing `Message` format throughout the application.

## What Was Completed

### 1. Strategic Analysis

Created `/Users/deniz.okcu/development/deniz/nanocollective/nanocoder/.nanocoder/PHASE-3-STRATEGY.md` analyzing three approaches:

- **Option A (Rejected)**: Keep converting, losing type safety
- **Option B (CHOSEN)**: Dual format - proper CoreMessage at AI SDK boundary, Message internally
- **Option C (Rejected)**: Full migration everywhere - too disruptive

**Decision**: Option B provides the best balance of proper AI SDK usage and minimal disruption.

### 2. Updated `source/ai-sdk-client.ts`

#### Imports

- ✅ Added `import type {CoreMessage} from 'ai'`
- ✅ Now properly importing AI SDK's native message types

#### Conversion Function

- ✅ Renamed `convertMessagesToAISDK()` → `convertToCoreMessages()`
- ✅ Returns proper `CoreMessage[]` type (not `any[]`)
- ✅ Explicitly handles all message roles:
  - `system` → CoreSystemMessage
  - `user` → CoreUserMessage
  - `assistant` → CoreAssistantMessage
  - `tool` → Converted to user message with `[Tool: name]` prefix
- ✅ No more type casting with `as any`

#### Usage Updates

- ✅ Updated both `chat()` and `chatStream()` methods
- ✅ Removed type casts: `messages: aiMessages as any` → `messages: coreMessages`
- ✅ Now passing properly typed `CoreMessage[]` to `generateText()` and `streamText()`

### 3. Tool Message Handling

**Decision**: Continue converting tool messages to user messages with clear labeling.

**Rationale**:

- AI SDK's `CoreToolMessage` format is complex and requires specific output types
- Converting to user messages with `[Tool: name]` prefix is simpler and more reliable
- Works consistently across all models
- LLM still receives full tool result context
- Maintains compatibility with existing conversation flow

**Format**:

```typescript
// Tool message: { role: 'tool', content: '...', name: 'read_file' }
// Converts to: { role: 'user', content: '[Tool: read_file]\n...' }
```

### 4. Testing & Verification

- ✅ Project builds successfully with `pnpm build`
- ✅ All type checks pass with `pnpm test:types`
- ✅ All 276 unit tests pass
- ✅ Code formatted with Prettier
- ✅ Linting passes
- ⚠️ Knip reports 10 unused `*CoreTool` exports - intentional (reserved for future use)

## Key Design Decisions

### Why Not Full `CoreMessage` Migration?

We chose **NOT** to replace `Message` with `CoreMessage` throughout the entire codebase because:

1. **Minimal Disruption**: Only changes at AI SDK boundary (one file)
2. **UI Compatibility**: Components continue using familiar `Message` format
3. **Storage Simplicity**: Conversation history remains in OpenAI-compatible format
4. **Future Flexibility**: Easy to fully migrate later if needed
5. **Proven Pattern**: Conversion at boundaries is a common architectural pattern

### Why Convert Tool Messages to User Messages?

After investigating AI SDK's `CoreToolMessage` format:

1. **Complexity**: Requires `content: [{ type: 'tool-result', toolCallId, toolName, output }]` with special output types
2. **Compatibility**: User message approach works reliably across all models
3. **Simplicity**: Clear `[Tool: name]` prefix provides context
4. **Existing Pattern**: Many AI SDK users adopt this simpler approach
5. **No Loss of Functionality**: LLM receives identical information

## Migration Status

| Phase   | Status      | Description                                                  |
| ------- | ----------- | ------------------------------------------------------------ |
| Phase 1 | ✅ COMPLETE | Type foundation - AI SDK types imported and exported         |
| Phase 2 | ✅ COMPLETE | Tool definitions migrated to AI SDK format                   |
| Phase 3 | ✅ COMPLETE | CoreMessage integration at AI SDK boundary                   |
| Phase 4 | ❌ TODO     | Remove any remaining conversion code, optimize client        |
| Phase 5 | ❌ TODO     | Evaluate MCP client migration (optional)                     |
| Phase 6 | ❌ TODO     | Comprehensive testing, documentation updates, CLAUDE.md sync |

## What Phase 3 Achieves

With Phase 3 complete, we now have:

1. **Proper Type Safety**: `CoreMessage` types used with AI SDK (no more `any` casts)
2. **Clean API Boundary**: Clear conversion point between internal and external formats
3. **Better Maintainability**: TypeScript catches message format errors at compile time
4. **AI SDK Compliance**: Following AI SDK's intended usage patterns
5. **Zero Breaking Changes**: No changes to hooks, components, or utilities

## Code Changes

### Files Modified

- `source/ai-sdk-client.ts` - Updated conversion function and type usage

### Files Created

- `.nanocoder/PHASE-3-STRATEGY.md` - Strategic analysis document
- `.nanocoder/PHASE-3-COMPLETE.md` - This completion document

### Lines of Code

- **Removed**: ~5 lines (simplified conversions, removed type casts)
- **Added**: ~35 lines (explicit role handling in `convertToCoreMessages()`)
- **Net Change**: ~30 lines added (more explicit, better typed)

## Testing Results

```bash
✅ Format check passed
✅ Type check passed
✅ Lint check passed (8 warnings - intentional `any` types)
✅ 276 AVA tests passed
⚠️  Knip reports 10 unused exports (*CoreTool) - intentional for future use
```

## What's NOT Done (Phase 4-6)

Phase 3 was intentionally focused. Still TODO:

### Phase 4: Client Optimization

- Review for any remaining unnecessary conversion code
- Optimize performance if needed
- Consider using `response.messages` if beneficial

### Phase 5: MCP Client (Optional)

- Evaluate `experimental_createMCPClient()` from AI SDK
- Decide whether to migrate or keep custom MCP client

### Phase 6: Final Polish

- Update CLAUDE.md with new architecture
- Add comprehensive integration tests for tool calling
- Document best practices for future contributors

## Comparison: Before vs After

### Before (Phase 2)

```typescript
function convertMessagesToAISDK(messages: Message[]): any[] {
	return messages.map((msg): any => {
		if (msg.role === 'tool') {
			return {
				role: 'user',
				content: `Tool result from ${msg.name}:\n${msg.content}`,
			};
		}
		return msg;
	});
}

const aiMessages = convertMessagesToAISDK(messages);
const result = await generateText({
	model,
	messages: aiMessages as any, // Type cast needed!
	tools: aiTools,
});
```

### After (Phase 3)

```typescript
function convertToCoreMessages(messages: Message[]): CoreMessage[] {
	return messages.map((msg): CoreMessage => {
		// Proper return type
		if (msg.role === 'tool') {
			const toolName = msg.name || 'unknown_tool';
			return {
				role: 'user',
				content: `[Tool: ${toolName}]\n${msg.content}`,
			};
		}
		if (msg.role === 'system') {
			return {role: 'system', content: msg.content};
		}
		if (msg.role === 'user') {
			return {role: 'user', content: msg.content};
		}
		if (msg.role === 'assistant') {
			return {role: 'assistant', content: msg.content};
		}
		return {role: 'user', content: msg.content};
	});
}

const coreMessages = convertToCoreMessages(messages);
const result = await generateText({
	model,
	messages: coreMessages, // No cast needed!
	tools: aiTools,
});
```

## Benefits Realized

1. **Type Safety**: TypeScript now catches message format errors
2. **Clarity**: Explicit handling of each message role
3. **Standards Compliance**: Using AI SDK's `CoreMessage` types as intended
4. **Maintainability**: Easier for future contributors to understand
5. **No Regressions**: All existing functionality preserved

## Conclusion

Phase 3 is successfully complete. The AI SDK integration is now cleaner and more maintainable, with proper type safety at the API boundary while preserving our internal architecture. The next step (Phase 4) is optional optimization and cleanup.

**Next Action:** Review Phase 4 scope or proceed with optional improvements.
