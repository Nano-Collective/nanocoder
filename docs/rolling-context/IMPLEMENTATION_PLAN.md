# Rolling Context Implementation Plan

## Problem

Tool outputs (file reads, bash results, search results) accumulate in conversation history, causing context to grow unboundedly. This leads to:
- Hitting model context limits
- Degraded performance as context grows
- Increased token costs

## Solution Overview

Implement a **rolling-context system** that intelligently manages tool outputs by:
1. Dropping old tool outputs after N steps (main feature)
2. Optionally summarizing truncated content
3. Preserving file-aware retrieval for recently referenced files

**Default: OFF** - Users enable via `/rolling-context` command.

---

## Implementation Phases

### Phase 0: Slash Command & Preference (Start Here)

**Files to modify/create:**
- `source/commands/rolling-context.tsx` (new)
- `source/commands/index.ts` (add export)
- `source/types/config.ts` (add to UserPreferences)
- `source/config/preferences.ts` (add getter/setter)
- `source/hooks/useAppInitialization.tsx` (register command)
- `source/hooks/useAppState.tsx` (add state)

See `PHASE0_COMMAND.md` for detailed implementation.

### Phase 1: Tool Output Truncation (Core)

**File:** `source/utils/context-manager.ts` (new)

```typescript
interface ContextManagerConfig {
  maxToolOutputAge: number;      // Default: 5 steps
  maxToolOutputTokens: number;   // Default: 2000 per output
  preserveRecentFiles: boolean;  // Default: true
}
```

**Key Functions:**
- `truncateOldToolOutputs(messages: Message[], currentStep: number): Message[]`
- `shouldTruncateToolResult(message: Message, age: number): boolean`
- `createTruncatedPlaceholder(originalMessage: Message): Message`

**Integration Point:** `source/hooks/chat-handler/use-chat-handler.tsx`
- Call `truncateOldToolOutputs()` before sending messages to LLM

### Phase 2: File-Aware Retrieval

**File:** `source/utils/context-manager.ts` (extend)

Track which files are "active" based on recent references:
- Files read in last N steps remain fully available
- Older file contents get truncated with metadata preserved

```typescript
interface FileReference {
  path: string;
  lastAccessStep: number;
  contentHash?: string;
}

function getActiveFiles(messages: Message[], currentStep: number): FileReference[]
function shouldPreserveFileContent(file: FileReference, currentStep: number): boolean
```

### Phase 3: Automatic Summarization (Optional)

**File:** `source/utils/context-summarizer.ts` (new)

Summarize truncated tool outputs instead of removing them entirely:
- Generate brief summaries of dropped content
- Preserve key information (file paths, error messages, success/failure)
- Use lightweight local processing (no LLM calls)

```typescript
function summarizeToolOutput(toolResult: Message): string
function extractKeyInfo(content: string, toolName: string): KeyInfo
```

---

## File Structure

```
source/utils/
├── context-manager.ts          # Core truncation logic
├── context-manager.spec.ts     # Tests
├── context-summarizer.ts       # Summarization logic
└── context-summarizer.spec.ts  # Tests

source/hooks/chat-handler/
└── use-chat-handler.tsx        # Integration point
```

---

## Configuration

Add to `agents.config.json`:

```json
{
  "contextManagement": {
    "enabled": true,
    "maxToolOutputAge": 5,
    "maxToolOutputTokens": 2000,
    "preserveRecentFiles": true,
    "summarizeOnTruncate": false
  }
}
```

---

## Testing Strategy

1. Unit tests for truncation logic
2. Integration tests verifying message flow
3. Test with long conversations to verify memory stays bounded
