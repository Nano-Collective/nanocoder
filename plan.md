# Auto-Compact Analysis & Implementation Plan

## Date: 2026-04-28

---

## Problem Statement

Auto-compact triggers when token usage hits a configured threshold during conversation, but it is not effectively reducing context for the current turn. The compression runs, updates React state, but downstream code in the same function overwrites that state — meaning the LLM never actually receives the compressed context for ongoing turns with tool calls.

---

## How It Works Today

### `/compact` (Manual Command)

**File:** `source/app/utils/handlers/compact-handler.ts`

1. Creates a tokenizer for the current provider/model.
2. Builds `[systemMessage, ...messages]`.
3. Calls `compressMessages(allMessages, tokenizer, {mode})`.
4. Stores a backup via `compressionBackup.storeBackup(messages)`.
5. Filters out system messages from result, then calls `setMessages(compressedUserMessages)`.
6. Shows a success message to the user.
7. **Stops.** No further action. The next user prompt will use the compacted history.

### Auto-Compact (Automatic Threshold-Based)

**Trigger file:** `source/hooks/chat-handler/conversation/conversation-loop.tsx` (~line 387)
**Core logic:** `source/utils/auto-compact.ts` → `performAutoCompact()`

Flow inside `processAssistantResponse()`:

1. Agent responds, assistant message is built into `updatedMessages`.
2. `setMessages(updatedMessages)` is called (adds assistant response to state).
3. **Auto-compact check runs** (`performAutoCompact(...)`):
   - Calculates token usage of `[systemMessage, ...updatedMessages]`.
   - If usage >= threshold: stores backup, calls `compressMessages(messages, ...)`, shows notification, then calls `setMessages(compressed)`.
4. **Then tool execution continues** — and here's where it breaks (see below).

### Shared Compression Logic

Both paths call `compressMessages()` in `source/utils/message-compression.ts`. This function is **purely rule-based, no LLM involved**:

- Keeps last N messages at full detail (default: 2).
- System messages are always preserved as-is.
- Tool results are reduced to `"Tool: {name}\nResult: success"` or error summaries.
- Long user/assistant messages (>500 chars default mode, >1000 conservative) are truncated via `summarizeText()` which keeps the first sentences up to a target length (~200 chars default, ~100 aggressive, ~500 conservative), then appends `"..."`.
- No AI summarization. No prompt sent to any model. It's string truncation.

---

## The Bug: Auto-Compact State Gets Overwritten

This is the core issue. Here is the sequence inside `processAssistantResponse()`:

```
Line ~383:   setMessages(updatedMessages);           // <-- state = original + assistant response
Line ~394:   const compressed = await performAutoCompact(...);
Line ~417:     setMessages(compressed);              // <-- state = COMPRESSED (good!)
...
Line ~561+:  const directBuilder = new MessageBuilder(updatedMessages);
             // ^^^ Uses LOCAL VARIABLE, not current React state!
Line ~565:    setMessages(updatedMessagesWithTools); // <-- OVERRIDES compacted state with pre-compaction messages + tool results
```

When auto-compact compresses and calls `setMessages(compressed)`, the next block of code that handles tool execution builds on top of `updatedMessages` — a **local variable** holding the pre-compaction message array. So when tools execute, their results are appended to the uncompressed history, completely discarding what auto-compact just did.

**Even worse:** If there are no tool calls but the conversation continues via recursion (e.g., empty response nudge at line ~670), the recursive call receives `messages: updatedMessagesWithNudge`, which is also built from the non-compacted local variable.

### Impact Summary

| Scenario | Auto-compact effective? |
|---|---|
| Agent responds with text only, no tools | ✅ Yes — compressed state persists until next user prompt |
| Agent responds with tool calls (direct execution) | ❌ No — overwritten by tool result path |
| Agent responds with tool calls needing confirmation | ❌ No — overwritten by confirmation flow handoff |
| Empty response → auto-nudge recursion | ❌ No — recursive call uses old messages |

Since most agent turns involve tool calls, auto-compact is effectively dead for the majority of conversations.

---

## Secondary Issue: Compression Quality

Both `/compact` and auto-compact use the same rule-based truncation. There is **no LLM-powered summarization**. The "compression" is essentially cutting off long strings after a few sentences and replacing tool outputs with one-liners. This means:

- Nuanced multi-step reasoning in assistant messages gets chopped to the first sentence + `"..."`.
- File contents written/edited are reduced to `"Tool: writeFile\nResult: success"` — losing all context about what was actually written.
- Error diagnostics beyond the first line are lost.

This is acceptable as a baseline heuristic, but it's worth noting that neither manual nor automatic compact sends anything to an LLM for intelligent summarization.

---

## Additional Difference: What Gets Compressed

| Aspect | `/compact` | Auto-compact |
|---|---|---|
| Messages passed to `compressMessages()` | `[systemMessage, ...messages]` (includes system) | `messages` only (system used only for threshold calc) |
| System message in output | Included, then filtered out before `setMessages` | Not included at all |
| Token counting includes system | Yes | Yes (for threshold check) |
| Shows preserved info stats | Yes (key decisions, file mods, etc.) | No (only shows token reduction %) |
| Triggers new conversation turn | No (just updates state) | No (continues current turn) |

---

## Implementation Plan

### Fix 1: Use Current State After Auto-Compact (Critical)

**Problem:** Tool execution and recursive calls use the pre-compaction local variable `updatedMessages`, overwriting compressed state.

**Solution:** After auto-compact successfully compresses messages, update the local reference so downstream code uses compressed messages.

**File:** `source/hooks/chat-handler/conversation/conversation-loop.tsx`

```typescript
// Around line 387 - after setMessages(compressed):
if (compressed) {
    setMessages(compressed);
    // FIX: Update the local reference so tool execution builds on compacted messages
    updatedMessagesRef.current = compressed;  // or reassign a let variable
    setTokenCount(0);
}
```

Then change all downstream references that build on `updatedMessages` to read from this reactive source (either a ref or by using the newly-set value). The cleanest approach is to make `updatedMessages` conditional:

```typescript
let workingMessages = updatedMessages;

try {
    const config = getAppConfig();
    const autoCompactConfig = config.autoCompact;
    if (autoCompactConfig) {
        const compressed = await performAutoCompact(...);
        if (compressed) {
            setMessages(compressed);
            workingMessages = compressed;  // <-- key fix
            setTokenCount(0);
        }
    }
} catch (_error) {}

// ... later in tool execution, use workingMessages instead of updatedMessages
const directBuilder = new MessageBuilder(workingMessages);
```

**Scope:** ~15 lines changed in one file. All downstream usages of `updatedMessages` after the auto-compact block need to switch to `workingMessages`.

### Fix 2: Include System Message in Auto-Compact Compression Input

**Problem:** `/compact` passes `[systemMessage, ...messages]` to `compressMessages()`, which preserves system messages and only compresses user/assistant/tool messages. Auto-compact only passes `messages`, so the system prompt context is missing from compression logic (though it's not lost — it's still injected by the chat handler on each LLM call).

**Solution:** Make auto-compact consistent with manual compact by passing `[systemMessage, ...messages]` to `compressMessages()` and filtering out system from the result before calling `setMessages()`.

**File:** `source/utils/auto-compact.ts` → `performAutoCompact()`

This ensures the compression algorithm treats both paths identically.

### Fix 3: Show Preserved Info Stats in Auto-Compact Notification

**Problem:** Manual `/compact` shows detailed stats (key decisions preserved, file modifications, tool results, recent messages). Auto-compact only shows token reduction percentage.

**Solution:** Use `CompressionResult.preservedInfo` in the notification callback, same format as manual compact.

**File:** `source/hooks/chat-handler/conversation/conversation-loop.tsx` notification callback + `source/utils/auto-compact.ts` return type.

### Fix 4: Prevent Double Compaction Within a Single Turn

**Problem:** If auto-compact triggers during tool execution recursion, it could compact again on an already-compacted history within the same conversation turn. The threshold check should account for recently compacted state.

**Solution:** Track last compaction timestamp or message count. Skip auto-compact if the previous compaction happened within the same turn (e.g., within the last N milliseconds or before a new user message was added).

**Approach:** Add a simple guard — store a flag or timestamp when auto-compact runs. In `performAutoCompact()`, skip if compaction occurred less than X seconds ago OR if current message count equals the message count at last compaction (meaning no new meaningful content has been added).

---

## Priority & Effort Estimate

| Fix | Priority | Effort | Risk |
|-----|----------|--------|------|
| Fix 1: State overwrite | **P0 - Critical** | Small (~15 lines) | Low — localized change in one function |
| Fix 2: Consistent input | P1 - Important | Tiny (~3 lines) | Very low — parity with manual compact |
| Fix 3: Better notification | P2 - Nice to have | Small (~5 lines) | None — cosmetic |
| Fix 4: Double compaction guard | P1 - Important | Medium (~20 lines) | Low — needs careful testing of recursion paths |

### Recommended Rollout Order

1. **Fix 1 first** — this is the core bug that makes auto-compact effectively useless for tool-using turns. Without this, fixes 2-4 don't matter much.
2. **Fix 2 and 3 together** — quick wins for consistency.
3. **Fix 4** — safety net once the main flow works correctly.

---

## Files Involved

| File | Role | Changes Needed |
|------|------|----------------|
| `source/hooks/chat-handler/conversation/conversation-loop.tsx` | Conversation loop / auto-compact trigger | Fix 1 (state overwrite), Fix 3 (notification), Fix 4 (guard) |
| `source/utils/auto-compact.ts` | Auto-compact logic (`performAutoCompact`) | Fix 2 (system message in input), Fix 4 (timestamp tracking) |
| `source/app/utils/handlers/compact-handler.ts` | Manual `/compact` handler | No changes needed (reference implementation) |
| `source/utils/message-compression.ts` | Core compression algorithm | No changes needed (used by both paths) |
