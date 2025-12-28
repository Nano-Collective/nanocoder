# Rolling Context Implementation Plan

## Problem

LLM providers enforce **hard context limits** and will reject requests that exceed them. Tool outputs (file reads, bash results, search results) accumulate in conversation history, causing context to grow unboundedly. This leads to:

- Runtime errors from context overflow (requests rejected before generation)
- Degraded performance as context grows
- Increased token costs
- Inability to run long agent sessions

## Solution Overview

Implement a **provider-agnostic Prompt Management Layer** that:

1. **Estimates token usage** before every request
2. **Enforces context budgets** based on model limits
3. **Trims old content deterministically** when necessary
4. **Optionally summarizes** dropped context for continuity
5. **Works consistently** across all LLM providers

**Default: OFF** - Users enable via `/rolling-context` command.

---

## Architecture

### Prompt Management Layer

A new layer that sits **between application logic and the LLM provider adapter**:

```
┌──────────────────────────────────────────────────────────────┐
│                     Application Logic                        │
│              (chat-handler, message-handler)                 │
└──────────────────────┬───────────────────────────────────────┘
                       │ messages + config
                       ▼
┌──────────────────────────────────────────────────────────────┐
│                 Prompt Management Layer                      │
│  ┌─────────────────┐  ┌──────────────────┐  ┌─────────────┐  │
│  │ Token Estimator │  │ Context Budget   │  │   Trimmer   │  │
│  │  (pluggable)    │  │   Enforcer       │  │ (priority)  │  │
│  └────────┬────────┘  └────────┬─────────┘  └──────┬──────┘  │
│           │                    │                    │        │
│           └────────────────────┼────────────────────┘        │
│                                ▼                             │
│                    ┌───────────────────┐                     │
│                    │   Prompt Builder  │                     │
│                    │ (final assembly)  │                     │
│                    └─────────┬─────────┘                     │
└──────────────────────────────┼───────────────────────────────┘
                               │ safe prompt (within budget)
                               ▼
┌──────────────────────────────────────────────────────────────┐
│                    LLM Provider Adapter                      │
│                     (ai-sdk-client.ts)                       │
└──────────────────────────────────────────────────────────────┘
```

### Core Abstractions

```typescript
// source/context/index.ts - Public API

// Token estimation (provider-agnostic)
estimateTokens(messages: Message[], model?: string): number

// Budget enforcement
enforceContextLimit(
  messages: Message[],
  maxInputTokens: number
): { messages: Message[]; truncated: boolean; droppedCount: number }

// Deterministic trimming
trimConversation(
  messages: Message[],
  targetTokens: number,
  options?: TrimOptions
): Message[]

// Optional summarization
summarizeContext(
  messages: Message[],
  options?: SummarizeOptions
): Promise<{ summary: string; originalTokens: number }>

// Final prompt assembly
buildFinalPrompt(
  messages: Message[],
  config: ContextConfig
): { messages: Message[]; tokenCount: number; withinBudget: boolean }
```

---

## Implementation Phases

### Phase 0: Slash Command & Preference (Start Here)

Add `/rolling-context` toggle command and configuration types.

**Files:**
- `source/commands/rolling-context.tsx` (new)
- `source/commands/index.ts` (add export)
- `source/types/config.ts` (add types)
- `source/config/preferences.ts` (add getter/setter)
- `source/hooks/useAppInitialization.tsx` (register command)

See `PHASE0_COMMAND.md` for detailed implementation.

### Phase 1: Token Budget Enforcement (Core)

Implement token estimation and context budget enforcement.

**New module:** `source/context/`

```typescript
interface ContextConfig {
  maxContextTokens: number;       // Model's hard limit
  reservedOutputTokens: number;   // Reserved for response (default: 4096)
  // Computed: maxInputTokens = maxContextTokens - reservedOutputTokens
}

interface TokenEstimator {
  estimate(content: string): number;
  estimateMessages(messages: Message[]): number;
}
```

**Key requirements:**
- Pluggable tokenizers per model/provider
- Fallback heuristic when exact tokenizer unavailable
- Conservative estimates (better to over-estimate)
- Estimate tokens for: system prompts, user messages, assistant replies, tool outputs, file contents

See `PHASE1_TRUNCATION.md` for detailed implementation.

### Phase 2: Deterministic Trimming

Implement priority-based content preservation and trimming.

**Preservation priority (highest to lowest):**
1. System instructions
2. Agent/tool instructions (from AGENTS.md)
3. Current task description
4. Actively edited files or inputs
5. Most recent conversation turns

**Trim first:**
- Old conversation history
- Stale tool outputs
- Previously summarized content

See `PHASE2_FILE_RETRIEVAL.md` for detailed implementation.

### Phase 3: Automatic Summarization (Optional)

Summarize truncated content to preserve context continuity.

**Options:**
- Rule-based extraction (no LLM, fast and free)
- LLM-based summarization (uses same abstraction layer)

**Requirements:**
- Store summaries as persistent memory (`conversation_summary`)
- Re-inject summaries into future prompts as compressed context
- Never cause recursive overflow (summarization must not exceed limits)

See `PHASE3_SUMMARIZATION.md` for detailed implementation.

---

## Functional Requirements

### 1. Token Estimation (Provider-Agnostic)

```typescript
// Pluggable tokenizer interface
interface Tokenizer {
  encode(text: string): number[];
  count(text: string): number;
}

// Registry of tokenizers by model family
const tokenizers: Record<string, Tokenizer> = {
  'claude': claudeTokenizer,
  'gpt': gptTokenizer,
  'llama': llamaTokenizer,
};

// Fallback heuristic: ~4 chars per token
function fallbackEstimate(text: string): number {
  return Math.ceil(text.length / 4);
}
```

### 2. Context Budget Enforcement

```typescript
interface BudgetConfig {
  maxContextTokens: number;
  reservedOutputTokens: number;
}

function computeMaxInputTokens(config: BudgetConfig): number {
  return config.maxContextTokens - config.reservedOutputTokens;
}

// All requests must fit within maxInputTokens
// This logic must be centralized and reusable
```

### 3. Hard Safety Rule

**Never send a request that exceeds the context budget.**

If trimming and summarization still exceed limits:
1. Abort the request safely
2. Emit a clear error
3. Ask for user intervention (chunking, narrowing scope)

```typescript
function buildFinalPrompt(messages: Message[], config: ContextConfig): PromptResult {
  const tokenCount = estimateTokens(messages);
  const maxInput = config.maxContextTokens - config.reservedOutputTokens;

  if (tokenCount > maxInput) {
    const trimmed = trimConversation(messages, maxInput);
    const newCount = estimateTokens(trimmed);

    if (newCount > maxInput) {
      // Still exceeds - abort safely
      throw new ContextOverflowError(
        `Cannot fit request within context limit. ` +
        `Current: ${newCount} tokens, Max: ${maxInput} tokens. ` +
        `Please narrow the scope or start a new session.`
      );
    }

    return { messages: trimmed, tokenCount: newCount, withinBudget: true };
  }

  return { messages, tokenCount, withinBudget: true };
}
```

---

## File Structure

```
source/context/
├── index.ts                  # Public API exports
├── token-estimator.ts        # Token counting with pluggable tokenizers
├── token-estimator.spec.ts   # Tests
├── context-budget.ts         # Budget enforcement logic
├── context-budget.spec.ts    # Tests
├── context-trimmer.ts        # Deterministic trimming algorithm
├── context-trimmer.spec.ts   # Tests
├── context-summarizer.ts     # Summarization logic
├── context-summarizer.spec.ts # Tests
├── prompt-builder.ts         # Final prompt assembly
├── prompt-builder.spec.ts    # Tests
├── file-tracker.ts           # File reference tracking
└── file-tracker.spec.ts      # Tests

source/hooks/chat-handler/
└── use-chat-handler.tsx      # Integration point
```

---

## Configuration

Add to `agents.config.json`:

```json
{
  "contextManagement": {
    "enabled": true,
    "maxContextTokens": 128000,
    "reservedOutputTokens": 4096,
    "trimStrategy": "priority-based",
    "preserveSystemPrompt": true,
    "preserveRecentTurns": 5,
    "summarizeOnTruncate": false,
    "tokenEstimator": "auto"
  }
}
```

---

## Success Criteria

The implementation is successful if:

- [ ] Context overflow errors are eliminated
- [ ] Agent sessions can run indefinitely
- [ ] Behavior is consistent across providers
- [ ] Long files and conversations are handled safely
- [ ] Prompt size never exceeds configured limits
- [ ] Token usage is logged for debugging

---

## Testing Strategy

1. **Unit tests** for each module (estimator, budget, trimmer, summarizer)
2. **Integration tests** verifying message flow through the layer
3. **Stress tests** with long conversations to verify memory stays bounded
4. **Provider tests** ensuring consistent behavior across OpenAI, Anthropic, local models

---

## Deliverables

1. [x] Implementation plan (this document)
2. [ ] List of affected modules
3. [ ] Code changes for each phase
4. [ ] Tests for all core functionality
5. [ ] Token usage logging
6. [ ] User documentation
