# Fix for llama.cpp Role Alternation Error with Mistral Models

## Problem

When using nanocoder with the llama.cpp provider and Mistral models (e.g., `mistralai_Devstral-Small-2-24B-Instruct-2512`), users encountered the following error after sending the second message:

```
Server error: After the optional system message, conversation roles must alternate user and assistant roles except for tool calls and results.
```

This error originates from the Mistral model's chat template (Jinja2), which enforces strict role alternation between user and assistant messages.

## Root Cause

The issue occurred because of how messages were being prepared before sending to the AI SDK. When empty assistant messages were filtered out (which is necessary to avoid API errors), consecutive user messages could remain in the message array. While this is technically valid from nanocoder's perspective, Mistral's chat template requires strict alternation:

1. Optional system message
2. user message
3. assistant message
4. user message
5. assistant message
6. ... (pattern continues)

When empty assistant messages were removed, the conversation might look like:
- user: "hi"
- assistant: "Hello! How can I assist you today?"
- user: "understand the current code changes..."
- [Another user message or empty assistant removed, breaking alternation]

Tool messages are exceptions and don't count toward alternation, but consecutive user or assistant messages violate the template's requirements.

## Solution

The fix was implemented in `source/ai-sdk-client/chat/streaming-handler.ts` by adding a third pass to the `createPrepareStepHandler` function. Instead of removing consecutive messages of the same role (which would lose information), the solution merges them:

### Implementation Details

1. **Empty Message Filtering** (First Pass): Remove empty assistant messages and their orphaned tool results
2. **Message Merging** (Third Pass): Merge consecutive user or assistant messages by combining their content with `\n\n` separator

```typescript
// Merge consecutive messages of the same role
if (
  lastMsg &&
  lastMsg.role === msg.role &&
  (msg.role === 'user' || msg.role === 'assistant')
) {
  // Combine content strings with newline separator
  lastMsg.content = lastContent + '\n\n' + currentContent;
}
```

### Why Merging Instead of Removing?

- **Preserves Information**: All user messages and assistant messages are retained
- **Maintains Context**: The full conversation history is available to the model
- **Enforces Alternation**: Consecutive messages of the same role are combined into single messages
- **No Breaking Changes**: The functionality works correctly for all providers, not just those with strict templates

## Files Changed

1. **source/ai-sdk-client/chat/streaming-handler.ts**
   - Added message merging logic in `createPrepareStepHandler`
   - Lines 105-174

2. **source/ai-sdk-client/chat/streaming-handler.spec.ts**
   - Updated test expectations to reflect merging behavior
   - Tests now verify that consecutive messages are merged with `\n\n` separator

## Testing

All AI SDK client tests pass after the changes:
- ✔ 74 tests passed in ai-sdk-client module
- ✔ Message filtering and merging work correctly
- ✔ Role alternation is enforced for strict chat templates
- ✔ No regressions in existing functionality

## How to Test the Fix

1. Build the project:
   ```bash
   pnpm run build
   ```

2. Run nanocoder with llama.cpp and Mistral model:
   ```bash
   nanocoder
   # Switch to llama.cpp provider with Mistral model
   ```

3. Send multiple messages in succession to verify no role alternation errors occur

## Impact

- **Fixes**: Role alternation errors with Mistral and other strict chat template models
- **Compatible**: Works with all existing providers and models
- **No Breaking Changes**: Existing behavior is preserved for models without strict alternation requirements
- **Performance**: Minimal overhead from the additional merging pass

## Related Models

This fix applies to any model that enforces strict role alternation in its chat template, including:
- Mistral family (Mistral 7B, Mixtral, Devstral, etc.)
- Some Llama models with strict templates
- Other models using Jinja2 templates with role alternation checks

## Future Considerations

1. Consider adding a provider-specific flag to enable/disable merging for models that don't need it
2. Add logging when merging occurs to help debug conversation flow issues
3. Consider making the merge separator configurable (currently hardcoded as `\n\n`)
