# PR #306 Review: `/compact` for Context Compression

**PR:** https://github.com/Nano-Collective/nanocoder/pull/306
**Author:** Pahari47
**Closes:** #13
**Review Date:** 2026-01-20
**Reviewer Branch:** `claude/review-pr-306-v28uK`

---

## Overview

This PR implements a message compression system to reduce token usage in extended conversations. It adds both manual (`/compact` command) and automatic compression capabilities.

**Files Changed:** 13 files | **+1,157 / -7 lines**

---

## Action Items

### Critical (Must Fix Before Merge)

- [ ] **Fix race condition in auto-compact** (`source/hooks/chat-handler/conversation/conversation-loop.tsx:235-272`)
  - The `void (async () => {...})()` pattern creates a detached async operation
  - `setMessages(compressed)` could overwrite newer state or cause data loss
  - **Fix:** Either await the operation or implement a state update queue/lock

- [ ] **Fix inconsistent token counting**
  - `/status` and auto-compact include system message in token count
  - `/compact` and `/compact --preview` do NOT include system message
  - User sees different numbers between commands
  - **Fix:** Include system message in manual compact token calculations (`source/app/utils/app-util.ts:370`)

### Significant (Should Fix)

- [ ] **Implement `--restore` flag** (`source/app/utils/app-util.ts`)
  - `compressionBackup.ts` has `restore()` method but it's never called
  - PR description mentions "save/restore functionality"
  - **Fix:** Add `--restore` argument handling in `handleCompactCommand()`

- [ ] **Refactor config loading duplication** (`source/config/index.ts:113-205`)
  - Same ~30-line block repeated 3 times for project/global/home paths
  - **Fix:** Extract to helper function `tryLoadAutoCompactFromPath(path, defaults)`

- [ ] **Fix empty command handler** (`source/commands/compact.ts`)
  - Handler returns empty Fragment, actual logic in `app-util.ts`
  - Inconsistent with other commands
  - **Fix:** Either move logic to handler or add comment explaining the pattern

### Moderate (Nice to Have)

- [ ] **Replace global mutable state** (`source/utils/auto-compact.ts:11-15`)
  - `autoCompactSessionOverrides` is exported mutable object
  - **Fix:** Use singleton class pattern like `compressionBackup`

- [ ] **Extract magic numbers to constants**
  - `500` - user message compression threshold
  - `300` - assistant with tool_calls threshold
  - `100` - aggressive truncation limit
  - `2` - default recent messages to keep
  - `50-95` - threshold valid range

- [ ] **Improve conservative mode** (`source/utils/message-compression.ts:264-267`)
  - Currently preserves ALL user messages regardless of length
  - Consider compressing very long user messages (>1000 chars?)

### Testing (Should Add)

- [ ] **Add unit tests for `message-compression.ts`**
  - Empty message arrays
  - Messages with only system messages
  - Very short conversations (< keepRecent messages)
  - Messages with undefined content
  - All three compression modes

- [ ] **Add unit tests for `auto-compact.ts`**
  - Threshold triggering
  - Session override behavior
  - Async behavior

- [ ] **Add unit tests for `compression-backup.ts`**
  - Store/restore cycle
  - Multiple backups (should overwrite)

---

## Detailed Findings

### Files Changed

| File | Purpose |
|------|---------|
| `source/utils/message-compression.ts` | Core compression logic (new) |
| `source/utils/auto-compact.ts` | Auto-compact feature (new) |
| `source/utils/compression-backup.ts` | Backup/restore (new) |
| `source/commands/compact.ts` | Command definition (new) |
| `source/app/utils/app-util.ts` | `/compact` handler logic |
| `source/hooks/chat-handler/conversation/conversation-loop.tsx` | Auto-compact trigger |
| `source/hooks/useAppHandlers.tsx` | Status display enhancements |
| `source/components/status.tsx` | UI for context info |
| `source/config/index.ts` | Config loading |
| `source/types/config.ts` | Type definitions |
| `source/hooks/useAppInitialization.tsx` | Command registration |
| `source/hooks/chat-handler/useChatHandler.tsx` | Provider passthrough |
| `source/commands/index.ts` | Export |

### Critical Issue Details

#### 1. Race Condition in Auto-Compact

**Location:** `source/hooks/chat-handler/conversation/conversation-loop.tsx:235-272`

```typescript
// PROBLEMATIC CODE
void (async () => {
  try {
    const config = getAppConfig();
    const autoCompactConfig = config.autoCompact;
    if (!autoCompactConfig) return;

    const compressed = await performAutoCompact(
      updatedMessages,
      systemMessage,
      currentProvider,
      currentModel,
      autoCompactConfig,
      notification => { /* ... */ },
    );

    if (compressed) {
      setMessages(compressed);  // Race condition here
    }
  } catch (_error) {
    // Silently fail
  }
})();
```

**Why it's a problem:**
- Parent function continues executing after firing this async operation
- Other state updates could happen before `setMessages(compressed)` runs
- Could overwrite newer messages or cause inconsistent state

**Suggested fix:**
```typescript
// Option 1: Await the operation
await (async () => { /* ... */ })();

// Option 2: Use a ref to track if compression is in progress
const isCompressing = useRef(false);
if (isCompressing.current) return;
isCompressing.current = true;
try { /* ... */ } finally { isCompressing.current = false; }
```

#### 2. Inconsistent Token Counting

| Location | Includes System Message? |
|----------|-------------------------|
| `/status` display | Yes |
| Auto-compact threshold check | Yes |
| `/compact` manual command | **No** |
| `/compact --preview` output | **No** |

**Location:** `source/app/utils/app-util.ts:370`

```typescript
// CURRENT - doesn't include system message
const result = compressMessages(messages, tokenizer, {mode});

// SHOULD BE - include system message for consistent reporting
const systemPrompt = processPromptTemplate();
const systemMessage: Message = { role: 'system', content: systemPrompt };
const allMessages = [systemMessage, ...messages];
const result = compressMessages(allMessages, tokenizer, {mode});
```

### Positive Aspects

1. **Proper tokenizer cleanup** - Consistent use of `finally` blocks to call `tokenizer.free()`
2. **System messages preserved** - Correctly excluded from compression
3. **Validation of config values** - Threshold clamped to 50-95%, mode validated against enum
4. **Good separation of concerns** - Compression logic separate from UI components
5. **Detailed statistics** - `preservedInfo` counts help users understand what was kept
6. **Session overrides** - Users can adjust settings per-session without modifying config

---

## Summary

| Severity | Count |
|----------|-------|
| Critical | 2 |
| Significant | 3 |
| Moderate | 3 |
| Testing | 3 |

**Recommendation:** Request changes for the critical race condition issue before merge. Other items can be addressed in follow-up PRs.
