# Phase 1: Token Budget Enforcement

**Prerequisite:** Phase 0 (command & preference) must be complete.

## Overview

Implement provider-agnostic token estimation and context budget enforcement. This is the **core safety layer** that prevents context overflow errors.

**Only runs when `rollingContextEnabled === true`** (set via `/rolling-context` command).

## Key Principle

**Never send a request that exceeds the context budget.**

All safety logic happens client-side because:
- LLM providers enforce hard context limits
- Providers do not automatically trim input
- Context overflow errors happen before generation

---

## Token Estimation

### Pluggable Tokenizer Interface

```typescript
// source/context/token-estimator.ts

/**
 * Interface for model-specific tokenizers
 */
export interface Tokenizer {
  name: string;
  encode(text: string): number[];
  count(text: string): number;
}

/**
 * Registry of tokenizers by model family
 */
const tokenizers: Map<string, Tokenizer> = new Map();

/**
 * Register a tokenizer for a model family
 */
export function registerTokenizer(family: string, tokenizer: Tokenizer): void {
  tokenizers.set(family, tokenizer);
}

/**
 * Get tokenizer for a model, with fallback to heuristic
 */
export function getTokenizer(model?: string): Tokenizer {
  if (model) {
    // Try exact match
    const exact = tokenizers.get(model);
    if (exact) return exact;

    // Try family match (e.g., "gpt-4" matches "gpt")
    for (const [family, tokenizer] of tokenizers) {
      if (model.toLowerCase().startsWith(family.toLowerCase())) {
        return tokenizer;
      }
    }
  }

  // Fallback to conservative heuristic
  return fallbackTokenizer;
}
```

### Fallback Heuristic

When an exact tokenizer is unavailable, use a conservative estimate:

```typescript
/**
 * Conservative fallback tokenizer
 * Uses ~3.5 chars per token (slightly conservative vs typical ~4)
 */
const fallbackTokenizer: Tokenizer = {
  name: 'fallback',
  encode: (text: string) => [],  // Not used for fallback
  count: (text: string) => Math.ceil(text.length / 3.5),
};
```

### Estimate Message Tokens

```typescript
/**
 * Estimate tokens for a single message
 */
export function estimateMessageTokens(message: Message, tokenizer: Tokenizer): number {
  let total = 0;

  // Role overhead (~4 tokens per message for structure)
  total += 4;

  // Content
  if (typeof message.content === 'string') {
    total += tokenizer.count(message.content);
  } else if (Array.isArray(message.content)) {
    // Handle multi-part content (text, images, etc.)
    for (const part of message.content) {
      if (part.type === 'text') {
        total += tokenizer.count(part.text);
      } else if (part.type === 'image') {
        // Conservative estimate for images
        total += 1000;
      }
    }
  }

  // Tool calls
  if (message.tool_calls) {
    for (const call of message.tool_calls) {
      total += tokenizer.count(call.function.name);
      total += tokenizer.count(JSON.stringify(call.function.arguments));
      total += 10; // Structure overhead
    }
  }

  return total;
}

/**
 * Estimate tokens for entire message array
 */
export function estimateTokens(messages: Message[], model?: string): number {
  const tokenizer = getTokenizer(model);
  let total = 0;

  for (const message of messages) {
    total += estimateMessageTokens(message, tokenizer);
  }

  // Add overhead for message list structure
  total += 3;

  return total;
}
```

### Built-in Tokenizer Support

Integrate with existing tokenization in `source/tokenization/`:

```typescript
// source/context/token-estimator.ts

import { countTokens as countClaudeTokens } from '@/tokenization/claude';
import { countTokens as countGPTTokens } from '@/tokenization/gpt';
import { countTokens as countLlamaTokens } from '@/tokenization/llama';

// Register built-in tokenizers
registerTokenizer('claude', {
  name: 'claude',
  encode: () => [],
  count: countClaudeTokens,
});

registerTokenizer('gpt', {
  name: 'gpt',
  encode: () => [],
  count: countGPTTokens,
});

registerTokenizer('llama', {
  name: 'llama',
  encode: () => [],
  count: countLlamaTokens,
});
```

---

## Context Budget

### Budget Configuration

```typescript
// source/context/context-budget.ts

import type { ContextManagementConfig } from '@/types/config';

export interface BudgetResult {
  maxInputTokens: number;
  currentTokens: number;
  availableTokens: number;
  withinBudget: boolean;
  utilizationPercent: number;
}

/**
 * Compute the maximum allowed input tokens
 */
export function computeMaxInputTokens(config: ContextManagementConfig): number {
  return config.maxContextTokens - config.reservedOutputTokens;
}

/**
 * Check if messages fit within budget
 */
export function checkBudget(
  messages: Message[],
  config: ContextManagementConfig,
  model?: string
): BudgetResult {
  const maxInputTokens = computeMaxInputTokens(config);
  const currentTokens = estimateTokens(messages, model);
  const availableTokens = maxInputTokens - currentTokens;

  return {
    maxInputTokens,
    currentTokens,
    availableTokens,
    withinBudget: currentTokens <= maxInputTokens,
    utilizationPercent: Math.round((currentTokens / maxInputTokens) * 100),
  };
}
```

### Enforce Budget

```typescript
/**
 * Enforce context limit, trimming if necessary
 */
export function enforceContextLimit(
  messages: Message[],
  config: ContextManagementConfig,
  model?: string
): {
  messages: Message[];
  truncated: boolean;
  droppedCount: number;
  originalTokens: number;
  finalTokens: number;
} {
  const maxInputTokens = computeMaxInputTokens(config);
  const originalTokens = estimateTokens(messages, model);

  if (originalTokens <= maxInputTokens) {
    return {
      messages,
      truncated: false,
      droppedCount: 0,
      originalTokens,
      finalTokens: originalTokens,
    };
  }

  // Trim messages to fit within budget
  const trimmed = trimConversation(messages, maxInputTokens, {
    preserveRecentTurns: config.preserveRecentTurns,
    strategy: config.trimStrategy,
    model,
  });

  const finalTokens = estimateTokens(trimmed, model);

  return {
    messages: trimmed,
    truncated: true,
    droppedCount: messages.length - trimmed.length,
    originalTokens,
    finalTokens,
  };
}
```

---

## Truncation Algorithm

### Step-Based Age Tracking

A "step" = one assistant turn (may include multiple tool calls).

```typescript
// source/context/context-trimmer.ts

interface TruncationConfig {
  maxAge: number;                    // Steps before truncation (default: 5)
  maxTokensPerOutput: number;        // Max tokens per tool result (default: 2000)
  placeholder: string;               // Replacement text template
  preserveErrors: boolean;           // Always keep error content
  preserveSmallOutputs: boolean;     // Don't truncate outputs under threshold
  smallOutputThreshold: number;      // Token threshold for "small" (default: 100)
}

const DEFAULT_TRUNCATION_CONFIG: TruncationConfig = {
  maxAge: 5,
  maxTokensPerOutput: 2000,
  placeholder: "[content truncated - {age} steps ago, {tokens} tokens]",
  preserveErrors: true,
  preserveSmallOutputs: true,
  smallOutputThreshold: 100,
};

/**
 * Count conversation steps (assistant turns with tool calls)
 */
function countSteps(messages: Message[]): number {
  return messages.filter(m =>
    m.role === 'assistant' && m.tool_calls?.length
  ).length;
}

/**
 * Tag each message with its step number
 */
function tagMessagesWithStep(messages: Message[]): Array<{message: Message; step: number}> {
  const tagged: Array<{message: Message; step: number}> = [];
  let currentStep = 0;

  for (const message of messages) {
    if (message.role === 'assistant' && message.tool_calls?.length) {
      currentStep++;
    }
    tagged.push({ message, step: currentStep });
  }

  return tagged;
}
```

### Core Trimming Logic

```typescript
/**
 * Trim conversation to fit within target token budget
 */
export function trimConversation(
  messages: Message[],
  targetTokens: number,
  options: Partial<TrimOptions> = {}
): Message[] {
  const config = { ...DEFAULT_TRUNCATION_CONFIG, ...options };
  const totalSteps = countSteps(messages);
  const taggedMessages = tagMessagesWithStep(messages);

  // First pass: truncate old tool outputs by age
  let processed = taggedMessages.map(({ message, step }) => {
    if (message.role !== 'tool') return message;

    const age = totalSteps - step;
    if (age > config.maxAge && shouldTruncate(message, config)) {
      return createPlaceholder(message, age, config);
    }
    return message;
  });

  // Check if we're within budget
  let currentTokens = estimateTokens(processed);
  if (currentTokens <= targetTokens) {
    return processed;
  }

  // Second pass: aggressively truncate older content
  // Start from oldest and work forward
  for (let i = 0; i < processed.length && currentTokens > targetTokens; i++) {
    const message = processed[i];
    if (message.role === 'tool' && !isPlaceholder(message)) {
      const tokensSaved = estimateMessageTokens(message) - 20; // Placeholder ~20 tokens
      processed[i] = createPlaceholder(message, 'old', config);
      currentTokens -= tokensSaved;
    }
  }

  // Third pass: if still over, remove oldest non-essential messages
  while (currentTokens > targetTokens && processed.length > config.preserveRecentTurns * 2) {
    // Find first removable message (not system, not recent)
    const removeIndex = processed.findIndex((m, i) =>
      m.role !== 'system' && i < processed.length - config.preserveRecentTurns * 2
    );

    if (removeIndex === -1) break;

    currentTokens -= estimateMessageTokens(processed[removeIndex]);
    processed.splice(removeIndex, 1);
  }

  return processed;
}

/**
 * Determine if a tool result should be truncated
 */
function shouldTruncate(message: Message, config: TruncationConfig): boolean {
  const content = typeof message.content === 'string' ? message.content : '';

  // Preserve error messages
  if (config.preserveErrors && containsError(content)) {
    return false;
  }

  // Preserve small outputs
  if (config.preserveSmallOutputs) {
    const tokens = estimateMessageTokens(message);
    if (tokens < config.smallOutputThreshold) {
      return false;
    }
  }

  return true;
}

/**
 * Check if content contains error indicators
 */
function containsError(content: string): boolean {
  const errorPatterns = [
    /error/i,
    /exception/i,
    /failed/i,
    /fatal/i,
    /cannot/i,
    /unable to/i,
  ];
  return errorPatterns.some(pattern => pattern.test(content));
}

/**
 * Create a placeholder for truncated content
 */
function createPlaceholder(
  message: Message,
  age: number | string,
  config: TruncationConfig
): Message {
  const originalContent = typeof message.content === 'string' ? message.content : '';
  const tokens = Math.ceil(originalContent.length / 4);

  const placeholder = config.placeholder
    .replace('{age}', String(age))
    .replace('{tokens}', String(tokens));

  return {
    ...message,
    content: placeholder,
    _truncated: true,
    _originalTokens: tokens,
  };
}
```

---

## Prompt Builder

### Final Assembly

```typescript
// source/context/prompt-builder.ts

import { estimateTokens } from './token-estimator';
import { enforceContextLimit } from './context-budget';
import { ContextManagementConfig } from '@/types/config';

export class ContextOverflowError extends Error {
  constructor(
    message: string,
    public currentTokens: number,
    public maxTokens: number
  ) {
    super(message);
    this.name = 'ContextOverflowError';
  }
}

export interface PromptResult {
  messages: Message[];
  tokenCount: number;
  withinBudget: boolean;
  wasTrimed: boolean;
  droppedCount: number;
}

/**
 * Build final prompt, ensuring it fits within budget
 * Throws ContextOverflowError if cannot fit after trimming
 */
export function buildFinalPrompt(
  messages: Message[],
  config: ContextManagementConfig,
  model?: string
): PromptResult {
  const maxInputTokens = config.maxContextTokens - config.reservedOutputTokens;
  const originalTokens = estimateTokens(messages, model);

  // Already within budget
  if (originalTokens <= maxInputTokens) {
    return {
      messages,
      tokenCount: originalTokens,
      withinBudget: true,
      wasTrimed: false,
      droppedCount: 0,
    };
  }

  // Try to trim to fit
  const result = enforceContextLimit(messages, config, model);

  // Verify we're now within budget
  if (!result.finalTokens || result.finalTokens > maxInputTokens) {
    throw new ContextOverflowError(
      `Cannot fit request within context limit. ` +
      `After trimming: ${result.finalTokens} tokens, Max: ${maxInputTokens} tokens. ` +
      `Please narrow the scope or start a new session.`,
      result.finalTokens,
      maxInputTokens
    );
  }

  return {
    messages: result.messages,
    tokenCount: result.finalTokens,
    withinBudget: true,
    wasTrimed: true,
    droppedCount: result.droppedCount,
  };
}
```

---

## Integration

### Chat Handler Integration

**File:** `source/hooks/chat-handler/use-chat-handler.tsx`

```typescript
import { getContextManagementConfig, getRollingContextEnabled } from '@/config/preferences';
import { buildFinalPrompt, ContextOverflowError } from '@/context/prompt-builder';
import { logWarning, logError } from '@/utils/message-queue';

// In the chat handler, before sending to LLM:

async function sendToLLM(messages: Message[], model: string): Promise<Response> {
  let processedMessages = messages;

  if (getRollingContextEnabled()) {
    const config = getContextManagementConfig();

    try {
      const result = buildFinalPrompt(messages, config, model);
      processedMessages = result.messages;

      if (result.wasTrimed) {
        logWarning(
          `Context trimmed: ${result.droppedCount} messages removed ` +
          `(${result.tokenCount.toLocaleString()} tokens)`
        );
      }
    } catch (error) {
      if (error instanceof ContextOverflowError) {
        logError(error.message);
        // Return error to user instead of crashing
        throw error;
      }
      throw error;
    }
  }

  return client.chat(processedMessages, tools, callbacks);
}
```

---

## Testing

```typescript
// source/context/token-estimator.spec.ts

import test from 'ava';
import { estimateTokens, getTokenizer } from './token-estimator';

test('fallback tokenizer uses conservative estimate', t => {
  const tokenizer = getTokenizer('unknown-model');
  const count = tokenizer.count('Hello, world!');
  // ~3.5 chars per token, so 13 chars -> ~4 tokens
  t.true(count >= 3 && count <= 5);
});

test('estimates message tokens including overhead', t => {
  const messages = [
    { role: 'user', content: 'Hello' },
    { role: 'assistant', content: 'Hi there!' },
  ];
  const tokens = estimateTokens(messages);
  // Should include role overhead (~4 per message) plus content
  t.true(tokens > 0);
});

// source/context/context-budget.spec.ts

test('enforceContextLimit returns unchanged when within budget', t => {
  const messages = [{ role: 'user', content: 'Hello' }];
  const config = { maxContextTokens: 10000, reservedOutputTokens: 1000 };
  const result = enforceContextLimit(messages, config);
  t.false(result.truncated);
  t.is(result.droppedCount, 0);
});

test('enforceContextLimit trims when over budget', t => {
  const largeContent = 'a'.repeat(50000);
  const messages = [
    { role: 'system', content: 'System prompt' },
    { role: 'user', content: 'Initial question' },
    { role: 'assistant', content: '', tool_calls: [{ id: '1', function: { name: 'read', arguments: {} }}]},
    { role: 'tool', tool_call_id: '1', content: largeContent },
    { role: 'user', content: 'Follow up' },
  ];
  const config = { maxContextTokens: 1000, reservedOutputTokens: 200 };
  const result = enforceContextLimit(messages, config);
  t.true(result.truncated);
  t.true(result.finalTokens < result.originalTokens);
});

// source/context/prompt-builder.spec.ts

test('buildFinalPrompt throws when cannot fit', t => {
  const hugeContent = 'a'.repeat(100000);
  const messages = [{ role: 'system', content: hugeContent }];
  const config = { maxContextTokens: 100, reservedOutputTokens: 50 };

  const error = t.throws(() => buildFinalPrompt(messages, config), {
    instanceOf: ContextOverflowError,
  });
  t.true(error.message.includes('Cannot fit request'));
});
```

---

## Token Usage Logging

```typescript
// source/context/usage-logger.ts

interface UsageLog {
  timestamp: Date;
  originalTokens: number;
  finalTokens: number;
  maxTokens: number;
  trimmed: boolean;
  droppedMessages: number;
}

const usageLogs: UsageLog[] = [];

export function logTokenUsage(entry: Omit<UsageLog, 'timestamp'>): void {
  usageLogs.push({ ...entry, timestamp: new Date() });

  // Keep last 100 entries
  if (usageLogs.length > 100) {
    usageLogs.shift();
  }
}

export function getUsageStats(): {
  totalRequests: number;
  trimmedRequests: number;
  avgUtilization: number;
} {
  const total = usageLogs.length;
  const trimmed = usageLogs.filter(l => l.trimmed).length;
  const avgUtil = usageLogs.reduce(
    (sum, l) => sum + l.finalTokens / l.maxTokens,
    0
  ) / total;

  return {
    totalRequests: total,
    trimmedRequests: trimmed,
    avgUtilization: Math.round(avgUtil * 100),
  };
}
```

---

## Next Steps

After completing Phase 1:
1. Verify token estimation accuracy with real conversations
2. Test budget enforcement with various model limits
3. Confirm truncation preserves essential context
4. Proceed to Phase 2 (Deterministic Trimming with Priorities)
