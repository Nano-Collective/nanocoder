# Phase 3: Automatic Summarization

**Prerequisite:** Phase 2 (priority-based trimming) must be complete.

## Overview

Instead of simply dropping old context, generate compact summaries that preserve key information. This allows:
- Long-running sessions without losing context
- Reduced token usage while maintaining continuity
- Stable agent reasoning across conversation boundaries

## Key Principle

**Summarization must never cause recursive overflow.**

The summarization process itself must:
- Fit within the remaining context budget
- Be optional and configurable
- Use the same LLM abstraction layer (when using LLM-based mode)

---

## Summarization Modes

### Mode 1: Rule-Based (Default)

Fast, free, no LLM calls. Uses pattern extraction.

**Pros:**
- Zero latency
- No additional token cost
- Deterministic output
- Works offline

**Cons:**
- Less intelligent extraction
- May miss nuanced context

### Mode 2: LLM-Based (Optional)

Uses the same LLM to generate intelligent summaries.

**Pros:**
- Higher quality summaries
- Captures intent and context
- More natural language

**Cons:**
- Additional token cost
- Latency for summary generation
- Requires recursive overflow protection

---

## Configuration

```typescript
// source/types/config.ts

export interface SummarizationConfig {
  enabled: boolean;                    // Default: false
  mode: 'rule-based' | 'llm-based';    // Default: 'rule-based'
  maxSummaryTokens: number;            // Max tokens for summary (default: 500)
  preserveErrorDetails: boolean;       // Keep full error messages (default: true)
  summaryPrompt?: string;              // Custom prompt for LLM mode
}

export const DEFAULT_SUMMARIZATION_CONFIG: SummarizationConfig = {
  enabled: false,
  mode: 'rule-based',
  maxSummaryTokens: 500,
  preserveErrorDetails: true,
};
```

---

## Rule-Based Summarization

### Tool-Specific Extractors

```typescript
// source/context/summarizers/rule-based.ts

export interface ToolSummary {
  toolName: string;
  status: 'success' | 'error' | 'partial';
  keyFacts: string[];
  metadata: Record<string, string | number>;
}

/**
 * Summarize a tool result using rule-based extraction
 */
export function summarizeToolResult(message: Message): ToolSummary {
  const toolName = message.name || 'unknown';
  const content = typeof message.content === 'string' ? message.content : '';

  const summarizer = toolSummarizers[toolName] || defaultSummarizer;
  return summarizer(content, message);
}

const toolSummarizers: Record<string, (content: string, msg: Message) => ToolSummary> = {
  read_file: summarizeReadFile,
  execute_bash: summarizeBash,
  search_files: summarizeSearch,
  grep: summarizeSearch,
  create_file: summarizeFileWrite,
  edit_file: summarizeFileEdit,
};
```

### File Read Summarizer

```typescript
function summarizeReadFile(content: string, message: Message): ToolSummary {
  const path = extractPath(message) || 'unknown';
  const lines = content.split('\n').length;
  const fileType = detectFileType(path);

  const keyFacts: string[] = [
    `File: ${path}`,
    `Lines: ${lines}`,
    `Type: ${fileType}`,
  ];

  // Extract structural info
  if (fileType === 'typescript' || fileType === 'javascript') {
    const exports = (content.match(/export\s+(const|function|class|interface|type)\s+(\w+)/g) || [])
      .slice(0, 5)
      .map(e => e.replace(/export\s+\w+\s+/, ''));
    if (exports.length) {
      keyFacts.push(`Exports: ${exports.join(', ')}`);
    }

    const imports = (content.match(/import\s+.*from\s+['"]([^'"]+)['"]/g) || []).length;
    if (imports) {
      keyFacts.push(`Imports: ${imports} modules`);
    }
  }

  return {
    toolName: 'read_file',
    status: 'success',
    keyFacts,
    metadata: {
      path,
      lines,
      hasExports: content.includes('export '),
      hasImports: content.includes('import '),
    },
  };
}
```

### Bash Summarizer

```typescript
function summarizeBash(content: string, message: Message): ToolSummary {
  const command = extractCommand(message) || 'unknown';
  const exitCode = extractExitCode(content);
  const hasError = /error|failed|exception/i.test(content);
  const outputLines = content.split('\n').length;

  const keyFacts: string[] = [
    `Command: ${truncateCommand(command, 60)}`,
    `Exit: ${exitCode}`,
    `Output: ${outputLines} lines`,
  ];

  if (hasError) {
    // Extract first error line
    const errorLine = content.split('\n').find(l => /error|failed/i.test(l));
    if (errorLine) {
      keyFacts.push(`Error: ${errorLine.slice(0, 100)}`);
    }
  }

  return {
    toolName: 'execute_bash',
    status: exitCode === 0 ? 'success' : 'error',
    keyFacts,
    metadata: {
      command,
      exitCode,
      outputLines,
      hasError,
    },
  };
}
```

### Search Summarizer

```typescript
function summarizeSearch(content: string, message: Message): ToolSummary {
  const pattern = extractPattern(message) || 'unknown';
  const matches = parseSearchResults(content);
  const files = [...new Set(matches.map(m => m.file))];

  const keyFacts: string[] = [
    `Pattern: "${pattern}"`,
    `Matches: ${matches.length}`,
    `Files: ${files.length}`,
  ];

  if (files.length > 0) {
    keyFacts.push(`Top files: ${files.slice(0, 3).join(', ')}`);
  }

  return {
    toolName: 'search',
    status: matches.length > 0 ? 'success' : 'partial',
    keyFacts,
    metadata: {
      pattern,
      matchCount: matches.length,
      fileCount: files.length,
    },
  };
}
```

### Format Summary

```typescript
/**
 * Format a tool summary as compact text
 */
export function formatSummary(summary: ToolSummary): string {
  const status = summary.status === 'error' ? '❌' : '✓';
  const facts = summary.keyFacts.join(' | ');
  return `[${status} ${summary.toolName}: ${facts}]`;
}

/**
 * Summarize multiple dropped messages
 */
export function summarizeDroppedMessages(
  messages: ClassifiedMessage[]
): string {
  const summaries = messages.map(m => {
    const summary = summarizeToolResult(m.message);
    return formatSummary(summary);
  });

  return `--- Summarized Context (${messages.length} items) ---\n${summaries.join('\n')}`;
}
```

---

## LLM-Based Summarization

### Safe Summarization with Budget

```typescript
// source/context/summarizers/llm-based.ts

import { LLMClient } from '@/ai-sdk-client';
import { estimateTokens } from '../token-estimator';

const DEFAULT_SUMMARY_PROMPT = `Summarize the following conversation context concisely.
Focus on:
1. What files were read/modified
2. What operations succeeded or failed
3. Key decisions or findings
4. Current state of the task

Keep the summary under {maxTokens} tokens. Be factual and brief.

Context to summarize:
{context}

Summary:`;

export interface LLMSummaryOptions {
  maxSummaryTokens: number;
  client: LLMClient;
  model: string;
  customPrompt?: string;
}

/**
 * Generate an LLM-based summary of dropped context
 * Includes recursive overflow protection
 */
export async function summarizeWithLLM(
  messages: ClassifiedMessage[],
  options: LLMSummaryOptions
): Promise<{ summary: string; tokensUsed: number }> {
  const { maxSummaryTokens, client, model, customPrompt } = options;

  // Build context string from dropped messages
  const contextParts = messages.map(m => {
    const role = m.message.role;
    const content = typeof m.message.content === 'string'
      ? m.message.content.slice(0, 1000)  // Limit each message
      : '[complex content]';
    return `[${role}]: ${content}`;
  });

  const context = contextParts.join('\n\n');

  // Check if context itself is too large
  const contextTokens = estimateTokens([{ role: 'user', content: context }], model);
  const promptTemplate = customPrompt || DEFAULT_SUMMARY_PROMPT;

  // If context is huge, use rule-based as fallback
  if (contextTokens > maxSummaryTokens * 2) {
    console.warn('Context too large for LLM summarization, falling back to rule-based');
    return {
      summary: summarizeDroppedMessages(messages),
      tokensUsed: 0,
    };
  }

  const prompt = promptTemplate
    .replace('{maxTokens}', String(maxSummaryTokens))
    .replace('{context}', context);

  try {
    const response = await client.chat(
      [{ role: 'user', content: prompt }],
      [], // No tools for summary
      {
        maxTokens: maxSummaryTokens,
        model,
      }
    );

    const summary = response.content || '';
    const tokensUsed = estimateTokens([{ role: 'assistant', content: summary }], model);

    return { summary, tokensUsed };
  } catch (error) {
    // Fallback to rule-based on error
    console.error('LLM summarization failed, using rule-based:', error);
    return {
      summary: summarizeDroppedMessages(messages),
      tokensUsed: 0,
    };
  }
}
```

---

## Persistent Summary Storage

### Conversation Summary

```typescript
// source/context/conversation-summary.ts

export interface ConversationSummary {
  createdAt: number;
  updatedAt: number;
  content: string;
  tokensUsed: number;
  messagesIncluded: number;
  version: number;
}

/**
 * Manages persistent conversation summaries
 */
export class SummaryStore {
  private summary: ConversationSummary | null = null;

  /**
   * Update the running summary with new dropped content
   */
  async updateSummary(
    droppedMessages: ClassifiedMessage[],
    options: SummarizationConfig & { client?: LLMClient; model?: string }
  ): Promise<void> {
    let newContent: string;
    let tokensUsed = 0;

    if (options.mode === 'llm-based' && options.client) {
      const result = await summarizeWithLLM(droppedMessages, {
        maxSummaryTokens: options.maxSummaryTokens,
        client: options.client,
        model: options.model || 'default',
      });
      newContent = result.summary;
      tokensUsed = result.tokensUsed;
    } else {
      newContent = summarizeDroppedMessages(droppedMessages);
    }

    // Merge with existing summary
    if (this.summary) {
      // Append new summary, but keep total under limit
      const combined = `${this.summary.content}\n\n[Update ${this.summary.version + 1}]\n${newContent}`;
      const estimatedTokens = Math.ceil(combined.length / 4);

      if (estimatedTokens > options.maxSummaryTokens * 2) {
        // Summary is getting too long, need to re-summarize
        // For now, just keep the latest
        newContent = `[Condensed history]\n${newContent}`;
      } else {
        newContent = combined;
      }
    }

    this.summary = {
      createdAt: this.summary?.createdAt || Date.now(),
      updatedAt: Date.now(),
      content: newContent,
      tokensUsed: tokensUsed + (this.summary?.tokensUsed || 0),
      messagesIncluded: droppedMessages.length + (this.summary?.messagesIncluded || 0),
      version: (this.summary?.version || 0) + 1,
    };
  }

  /**
   * Get the current summary for injection into prompts
   */
  getSummary(): string | null {
    return this.summary?.content || null;
  }

  /**
   * Get summary as a system message for injection
   */
  getSummaryMessage(): Message | null {
    if (!this.summary) return null;

    return {
      role: 'system',
      content: `[Previous Conversation Summary]\n${this.summary.content}`,
    };
  }

  /**
   * Clear the summary (e.g., on new session)
   */
  clear(): void {
    this.summary = null;
  }
}
```

---

## Integration

### Inject Summary into Prompt

```typescript
// source/context/prompt-builder.ts

export function buildFinalPrompt(
  messages: Message[],
  config: ContextManagementConfig,
  summaryStore: SummaryStore,
  model?: string
): PromptResult {
  const maxInputTokens = config.maxContextTokens - config.reservedOutputTokens;

  // Reserve space for summary
  const summaryMessage = summaryStore.getSummaryMessage();
  const summaryTokens = summaryMessage
    ? estimateMessageTokens(summaryMessage)
    : 0;

  const availableForMessages = maxInputTokens - summaryTokens;

  // Enforce limit on messages
  const result = enforceContextLimit(messages, {
    ...config,
    maxContextTokens: availableForMessages + config.reservedOutputTokens,
  }, model);

  // If we trimmed and summarization is enabled, update summary
  if (result.truncated && config.summarizeOnTruncate) {
    // This would be async in practice
    // summaryStore.updateSummary(result.droppedMessages, config.summarization);
  }

  // Inject summary at the beginning (after system prompt)
  let finalMessages = result.messages;
  if (summaryMessage) {
    const systemIndex = finalMessages.findIndex(m => m.role === 'system');
    if (systemIndex >= 0) {
      finalMessages = [
        ...finalMessages.slice(0, systemIndex + 1),
        summaryMessage,
        ...finalMessages.slice(systemIndex + 1),
      ];
    } else {
      finalMessages = [summaryMessage, ...finalMessages];
    }
  }

  return {
    messages: finalMessages,
    tokenCount: estimateTokens(finalMessages, model),
    withinBudget: true,
    wasTrimed: result.truncated,
    droppedCount: result.droppedCount,
  };
}
```

---

## Recursive Overflow Protection

### Safety Checks

```typescript
/**
 * Ensure summarization never causes overflow
 */
export function safeSummarize(
  droppedMessages: ClassifiedMessage[],
  availableBudget: number,
  config: SummarizationConfig
): string {
  // Calculate maximum safe summary size
  const maxSafeTokens = Math.min(
    config.maxSummaryTokens,
    availableBudget * 0.1  // Never use more than 10% of available budget
  );

  if (maxSafeTokens < 50) {
    // Not enough room for a meaningful summary
    return '[Summary omitted - insufficient budget]';
  }

  // Use rule-based for safety (no LLM call that might fail)
  const summary = summarizeDroppedMessages(droppedMessages);

  // Truncate if necessary
  const estimatedTokens = Math.ceil(summary.length / 4);
  if (estimatedTokens > maxSafeTokens) {
    const charLimit = maxSafeTokens * 4;
    return summary.slice(0, charLimit) + '\n[Summary truncated]';
  }

  return summary;
}
```

---

## Testing

```typescript
// source/context/summarizers/rule-based.spec.ts

import test from 'ava';
import { summarizeToolResult, formatSummary } from './rule-based';

test('summarizes file read with metadata', t => {
  const message = {
    role: 'tool',
    name: 'read_file',
    content: `export function hello() {}\nexport const world = 42;\nimport { foo } from 'bar';`,
  };

  const summary = summarizeToolResult(message);

  t.is(summary.toolName, 'read_file');
  t.is(summary.status, 'success');
  t.true(summary.keyFacts.some(f => f.includes('Lines:')));
  t.true(summary.metadata.hasExports);
});

test('summarizes bash with error detection', t => {
  const message = {
    role: 'tool',
    name: 'execute_bash',
    content: 'npm test\nError: Module not found\nexit code: 1',
  };

  const summary = summarizeToolResult(message);

  t.is(summary.status, 'error');
  t.true(summary.keyFacts.some(f => f.includes('Error:')));
});

test('formats summary concisely', t => {
  const summary = {
    toolName: 'read_file',
    status: 'success' as const,
    keyFacts: ['File: /app.ts', 'Lines: 100'],
    metadata: {},
  };

  const formatted = formatSummary(summary);

  t.is(formatted, '[✓ read_file: File: /app.ts | Lines: 100]');
});

// source/context/summarizers/llm-based.spec.ts

test('falls back to rule-based when context too large', async t => {
  const hugeMessages = Array(100).fill({
    message: { role: 'tool', content: 'a'.repeat(10000) },
    priority: 30,
    tokens: 2500,
    step: 1,
    metadata: {},
  });

  const result = await summarizeWithLLM(hugeMessages, {
    maxSummaryTokens: 500,
    client: mockClient,
    model: 'test',
  });

  // Should have fallen back, not used LLM
  t.is(result.tokensUsed, 0);
  t.true(result.summary.includes('Summarized Context'));
});

// source/context/conversation-summary.spec.ts

test('accumulates summaries with version tracking', async t => {
  const store = new SummaryStore();

  await store.updateSummary([mockMessage1], config);
  t.is(store.getSummary()?.version, 1);

  await store.updateSummary([mockMessage2], config);
  t.is(store.getSummary()?.version, 2);
  t.true(store.getSummary()?.content.includes('Update 2'));
});
```

---

## Success Criteria

Phase 3 is complete when:

- [ ] Rule-based summarization extracts key facts from all tool types
- [ ] LLM-based summarization works with recursive overflow protection
- [ ] Summaries are stored and injected into future prompts
- [ ] Summary budget never exceeds configured limits
- [ ] Fallback to rule-based works when LLM fails

---

## Full Feature Complete

With Phase 3 complete, the rolling context feature provides:

1. **Token Estimation** - Conservative, provider-agnostic estimates
2. **Budget Enforcement** - Hard limits that never overflow
3. **Priority Trimming** - Intelligent preservation of important content
4. **Automatic Summarization** - Context continuity across long sessions

The agent can now run indefinitely without hitting context limits.
