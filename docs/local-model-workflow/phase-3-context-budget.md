# Phase 3: Context Budget Management

> **Status:** Not started
> **Priority:** P0
> **Depends on:** Nothing
> **Blocks:** Phases 2, 7, 10

---

## Goal

Implement precise token budget accounting so the system knows exactly how much context is available for conversation history, tool results, and model output. This prevents context overflow — the #2 cause of local model failures.

## Background

**From LocalClaw:** Before each LLM call, LocalClaw computes a precise budget: `availableForHistory = contextSize - systemTokens - currentMessageTokens - outputReserve - safetyMargin`. When history exceeds the budget, it proactively compacts at 50% (not when full).

**Current Nanocoder:** Has rough context percentage tracking (`useContextPercentage.ts`) and auto-compact at a configurable threshold, but doesn't do precise per-section accounting.

---

## Architecture

### Budget Calculation

```typescript
interface ContextBudget {
  totalTokens: number;           // Model's context window
  systemPromptTokens: number;    // System prompt (instructions, coding practices)
  toolDefinitionTokens: number;  // Tool schemas sent to model
  workspaceTokens: number;       // AGENTS.md + custom system prompt
  currentMessageTokens: number;  // The user's current message
  outputReserve: number;         // max_tokens reserved for response
  safetyMargin: number;          // Buffer for overhead (~256 tokens)
  availableForHistory: number;   // What's left for conversation history
}

function computeBudget(params: {
  contextSize: number;
  systemPrompt: string;
  toolDefinitions: string;
  workspaceContext: string;    // AGENTS.md, custom prompt
  currentMessage: string;
  outputReserve: number;       // from tune or model config
}): ContextBudget
```

### Priority Layers (from LocalClaw ROADMAP §2.1)

When `availableForHistory` is insufficient:

1. **Tool results** — most important, keep verbatim (they contain the data the model needs)
2. **Recent turns** — last 2–4 turns, keep verbatim (conversation continuity)
3. **Workspace context** — AGENTS.md, shrink or omit (can be re-read if needed)
4. **Old turns** — compress or summarize (least valuable, most tokens)

### Source Attribution (from LocalClaw ROADMAP §2.4)

Tag context sections so the model (and trimming logic) knows the origin:

```
[CONTEXT: system_prompt]
You are a coding assistant...

[CONTEXT: workspace]
# Project: my-app
...

[CONTEXT: tools]
Available tools: read_file, write_file, ...

[CONTEXT: history]
User: Fix the auth bug
Assistant: I'll read the auth file...
```

This helps the trimming logic make smart decisions about what to cut.

---

## Files to Create

### `source/context/budget.ts`

```typescript
import { estimateTokens } from '@/tokenization/estimate';

export interface ContextBudget {
  totalTokens: number;
  systemPromptTokens: number;
  toolDefinitionTokens: number;
  workspaceTokens: number;
  currentMessageTokens: number;
  outputReserve: number;
  safetyMargin: number;
  availableForHistory: number;
}

const SAFETY_MARGIN = 256;

export function computeBudget(params: {
  contextSize: number;
  systemPrompt: string;
  toolDefinitions: string;
  workspaceContext: string;
  currentMessage: string;
  outputReserve: number;
}): ContextBudget {
  const systemPromptTokens = estimateTokens(params.systemPrompt);
  const toolDefinitionTokens = estimateTokens(params.toolDefinitions);
  const workspaceTokens = estimateTokens(params.workspaceContext);
  const currentMessageTokens = estimateTokens(params.currentMessage);

  const availableForHistory = Math.max(
    0,
    params.contextSize
      - systemPromptTokens
      - toolDefinitionTokens
      - workspaceTokens
      - currentMessageTokens
      - params.outputReserve
      - SAFETY_MARGIN,
  );

  return {
    totalTokens: params.contextSize,
    systemPromptTokens,
    toolDefinitionTokens,
    workspaceTokens,
    currentMessageTokens,
    outputReserve: params.outputReserve,
    safetyMargin: SAFETY_MARGIN,
    availableForHistory,
  };
}
```

### `source/context/priority-trimmer.ts`

```typescript
import type { Message } from '@/types';
import { estimateMessagesTokens } from '@/tokenization/estimate';

export interface TrimResult {
  messages: Message[];
  trimmedSections: string[];
  tokensSaved: number;
}

/**
 * Trim messages to fit within the history budget using priority layers.
 *
 * Strategy:
 * 1. Keep last N turns verbatim (recent zone)
 * 2. For older turns: truncate large tool observations first
 * 3. If still over budget: remove oldest turns
 * 4. If still over budget: shrink workspace context (omit AGENTS.md)
 */
export function trimToBudget(
  messages: Message[],
  budgetTokens: number,
  recentTurnsToKeep: number = 4,
): TrimResult {
  const currentTokens = estimateMessagesTokens(messages);
  if (currentTokens <= budgetTokens) {
    return { messages, trimmedSections: [], tokensSaved: 0 };
  }

  const trimmedSections: string[] = [];
  let tokensSaved = 0;

  // Pass 1: Truncate large tool observations in older messages
  const protectedStart = Math.max(0, messages.length - recentTurnsToKeep * 2);
  const trimmed = [...messages];

  for (let i = 0; i < protectedStart; i++) {
    const msg = trimmed[i];
    if (msg.content && msg.content.length > 1000) {
      const original = msg.content;
      trimmed[i] = {
        ...msg,
        content: msg.content.slice(0, 300) + '\n[...truncated]',
      };
      const saved = original.length - trimmed[i].content.length;
      tokensSaved += Math.floor(saved / 4); // rough token estimate
      trimmedSections.push(`tool_observation_${i}`);
    }
  }

  // Pass 2: Remove oldest turns if still over budget
  let result = trimmed;
  while (estimateMessagesTokens(result) > budgetTokens && result.length > recentTurnsToKeep * 2) {
    result = result.slice(2); // Remove oldest user+assistant pair
    tokensSaved += 200; // rough estimate
    trimmedSections.push('oldest_turn');
  }

  return { messages: result, trimmedSections, tokensSaved };
}
```

---

## Files to Modify

### `source/tokenization/` — Enhance token estimation

Add LocalClaw's BPE-calibrated heuristic as an alternative estimator:

```typescript
// source/tokenization/estimate.ts

/**
 * BPE-calibrated token estimation.
 * Overestimates by ~10-15% (safer than underestimating).
 * From LocalClaw's src/context/tokens.ts.
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;

  let tokens = 0;
  const segments = text.split(/(\s+)/);

  for (const seg of segments) {
    if (!seg) continue;

    if (/^\s+$/.test(seg)) {
      tokens += (seg.match(/\n/g)?.length ?? 0) + 1;
      continue;
    }

    const len = seg.length;
    if (len <= 4) tokens += 1;
    else if (len <= 8) tokens += 2;
    else if (len <= 14) tokens += 3;
    else tokens += Math.ceil(len / 4);
  }

  return tokens;
}
```

### `source/hooks/chat-handler/` — Check budget before each call

Before each LLM call, compute the budget and trim if needed:

```typescript
const budget = computeBudget({
  contextSize: modelContextWindow,
  systemPrompt: systemPromptText,
  toolDefinitions: toolDefsText,
  workspaceContext: agentsMdText,
  currentMessage: userMessage,
  outputReserve: tuneSettings.maxTokens,
});

if (budget.availableForHistory < historyTokens) {
  const trimResult = trimToBudget(historyMessages, budget.availableForHistory);
  historyMessages = trimResult.messages;
}
```

---

## Test Plan

### `source/context/budget.spec.ts`

```
Test: Budget calculation
  - All fields computed correctly
  - availableForHistory = total - system - tools - workspace - current - output - safety
  - availableForHistory never goes below 0

Test: Budget with large system prompt
  - Workspace context can dominate the budget
  - availableForHistory shrinks appropriately

Test: Budget with small context window
  - 4096 token context with 2000 token system prompt
  - availableForHistory should be very small

Test: Priority trimmer
  - Messages under budget: no trimming
  - Large tool observations: truncated to 300 chars
  - Oldest turns: removed when still over budget
  - Protected recent turns: never removed
```

---

## Acceptance Criteria

- [ ] `computeBudget()` calculates precise token allocation
- [ ] Budget accounts for: system prompt, tools, workspace, current message, output reserve, safety margin
- [ ] Priority trimmer removes context in correct order: old tool observations → oldest turns → workspace
- [ ] Token estimation calibrated for BPE tokenizers (~10-15% overestimate)
- [ ] Budget check integrated into chat handler before each LLM call
- [ ] All tests pass

---

## LocalClaw References

- `src/context/budget.ts` — Budget calculator
- `src/context/tokens.ts` — BPE-calibrated token estimation
- `src/context/compactor.ts` — Proactive compaction at 50%
- `ROADMAP.md §2.1` — Context priority layers
- `ROADMAP.md §2.4` — Source attribution
