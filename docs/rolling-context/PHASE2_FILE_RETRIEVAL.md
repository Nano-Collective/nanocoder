# Phase 2: Deterministic Trimming with Preservation Priorities

**Prerequisite:** Phase 1 (token budget enforcement) must be complete.

## Overview

Implement priority-based content preservation that maintains correctness while fitting within budget. This phase adds intelligence to the trimming algorithm by understanding **what content matters most**.

## Key Principle

**Deterministic, testable, predictable trimming.**

The algorithm must:
- Always produce the same output for the same input
- Be unit testable with expected outcomes
- Preserve content in a defined priority order

---

## Preservation Priority Order

Content is preserved in strict priority order (highest to lowest):

| Priority | Content Type | Reason |
|----------|--------------|--------|
| 1 | System instructions | Core behavior, cannot be lost |
| 2 | Agent/tool instructions | From AGENTS.md, defines capabilities |
| 3 | Current task description | User's active request |
| 4 | Actively edited files | Files modified in this session |
| 5 | Most recent conversation turns | Immediate context |
| 6 | Recent file reads | Reference material |
| 7 | Old conversation history | Background context |
| 8 | Stale tool outputs | Easily re-runnable |
| 9 | Previously summarized content | Already compressed |

---

## Content Classification

### Message Classifier

```typescript
// source/context/content-classifier.ts

export enum ContentPriority {
  SYSTEM = 100,           // Never remove
  AGENT_INSTRUCTIONS = 90,
  CURRENT_TASK = 80,
  MODIFIED_FILES = 70,
  RECENT_TURNS = 60,
  RECENT_FILE_READS = 50,
  OLD_HISTORY = 40,
  STALE_TOOL_OUTPUTS = 30,
  SUMMARIZED = 20,
}

export interface ClassifiedMessage {
  message: Message;
  priority: ContentPriority;
  tokens: number;
  step: number;
  metadata: {
    isSystem?: boolean;
    isAgentInstruction?: boolean;
    isCurrentTask?: boolean;
    filePath?: string;
    wasModified?: boolean;
    age?: number;
    isSummarized?: boolean;
  };
}

/**
 * Classify a message by its preservation priority
 */
export function classifyMessage(
  message: Message,
  context: ClassificationContext
): ClassifiedMessage {
  const tokens = estimateMessageTokens(message);
  const step = context.messageStep;

  // System messages are highest priority
  if (message.role === 'system') {
    return {
      message,
      priority: ContentPriority.SYSTEM,
      tokens,
      step,
      metadata: { isSystem: true },
    };
  }

  // Agent instructions (from AGENTS.md injection)
  if (isAgentInstruction(message)) {
    return {
      message,
      priority: ContentPriority.AGENT_INSTRUCTIONS,
      tokens,
      step,
      metadata: { isAgentInstruction: true },
    };
  }

  // Current task (most recent user message before any tool calls)
  if (context.isCurrentTask) {
    return {
      message,
      priority: ContentPriority.CURRENT_TASK,
      tokens,
      step,
      metadata: { isCurrentTask: true },
    };
  }

  // File operations
  if (message.role === 'tool' && isFileOperation(message)) {
    const filePath = extractFilePath(message);
    const wasModified = context.modifiedFiles.has(filePath);
    const age = context.currentStep - step;

    if (wasModified) {
      return {
        message,
        priority: ContentPriority.MODIFIED_FILES,
        tokens,
        step,
        metadata: { filePath, wasModified: true },
      };
    }

    if (age <= context.recentThreshold) {
      return {
        message,
        priority: ContentPriority.RECENT_FILE_READS,
        tokens,
        step,
        metadata: { filePath, age },
      };
    }

    return {
      message,
      priority: ContentPriority.STALE_TOOL_OUTPUTS,
      tokens,
      step,
      metadata: { filePath, age },
    };
  }

  // Other tool outputs
  if (message.role === 'tool') {
    const age = context.currentStep - step;
    if (age <= context.recentThreshold) {
      return {
        message,
        priority: ContentPriority.RECENT_TURNS,
        tokens,
        step,
        metadata: { age },
      };
    }
    return {
      message,
      priority: ContentPriority.STALE_TOOL_OUTPUTS,
      tokens,
      step,
      metadata: { age },
    };
  }

  // Recent conversation turns
  const age = context.currentStep - step;
  if (age <= context.preserveRecentTurns) {
    return {
      message,
      priority: ContentPriority.RECENT_TURNS,
      tokens,
      step,
      metadata: { age },
    };
  }

  // Old history
  return {
    message,
    priority: ContentPriority.OLD_HISTORY,
    tokens,
    step,
    metadata: { age },
  };
}
```

---

## File Tracker

### Track Modified Files

```typescript
// source/context/file-tracker.ts

export interface FileReference {
  path: string;
  lastAccessStep: number;
  lastAccessTime: number;
  wasModified: boolean;
  operation: 'read' | 'create' | 'edit' | 'delete';
  contentPreview?: string;
  lineCount?: number;
}

export class FileTracker {
  private references = new Map<string, FileReference>();

  /**
   * Track file access from tool call
   */
  trackAccess(
    path: string,
    step: number,
    operation: FileReference['operation'],
    content?: string
  ): void {
    const existing = this.references.get(path);

    this.references.set(path, {
      path,
      lastAccessStep: step,
      lastAccessTime: Date.now(),
      wasModified: operation !== 'read' || existing?.wasModified || false,
      operation,
      contentPreview: content?.slice(0, 200),
      lineCount: content?.split('\n').length,
    });
  }

  /**
   * Check if file was modified in this session
   */
  wasModified(path: string): boolean {
    return this.references.get(path)?.wasModified ?? false;
  }

  /**
   * Get all modified files
   */
  getModifiedFiles(): Set<string> {
    const modified = new Set<string>();
    for (const [path, ref] of this.references) {
      if (ref.wasModified) {
        modified.add(path);
      }
    }
    return modified;
  }

  /**
   * Check if file access is stale
   */
  isStale(path: string, currentStep: number, maxAge: number): boolean {
    const ref = this.references.get(path);
    if (!ref) return true;
    return currentStep - ref.lastAccessStep > maxAge;
  }

  /**
   * Get recent file accesses
   */
  getRecentFiles(currentStep: number, maxAge: number): FileReference[] {
    const recent: FileReference[] = [];
    for (const ref of this.references.values()) {
      if (currentStep - ref.lastAccessStep <= maxAge) {
        recent.push(ref);
      }
    }
    return recent.sort((a, b) => b.lastAccessStep - a.lastAccessStep);
  }

  /**
   * Build tracker from message history
   */
  static fromMessages(messages: Message[]): FileTracker {
    const tracker = new FileTracker();
    let step = 0;

    for (const message of messages) {
      if (message.role === 'assistant' && message.tool_calls?.length) {
        step++;
      }

      if (message.role === 'tool') {
        const filePath = extractFilePath(message);
        const operation = detectOperation(message);

        if (filePath && operation) {
          tracker.trackAccess(filePath, step, operation, message.content);
        }
      }
    }

    return tracker;
  }
}

function extractFilePath(message: Message): string | null {
  // Try to extract from tool name patterns
  const toolName = message.name || '';
  const content = typeof message.content === 'string' ? message.content : '';

  // Common patterns
  if (toolName.includes('read') || toolName.includes('file')) {
    const match = content.match(/(?:File|Path):\s*([^\n]+)/);
    return match?.[1]?.trim() || null;
  }

  // Try JSON parsing for structured tool results
  try {
    const parsed = JSON.parse(content);
    return parsed.path || parsed.file || parsed.filePath || null;
  } catch {
    return null;
  }
}

function detectOperation(message: Message): FileReference['operation'] | null {
  const toolName = (message.name || '').toLowerCase();

  if (toolName.includes('create') || toolName.includes('write')) return 'create';
  if (toolName.includes('edit') || toolName.includes('modify')) return 'edit';
  if (toolName.includes('delete') || toolName.includes('remove')) return 'delete';
  if (toolName.includes('read') || toolName.includes('get')) return 'read';

  return null;
}
```

---

## Priority-Based Trimmer

### Trim Algorithm

```typescript
// source/context/priority-trimmer.ts

export interface TrimOptions {
  targetTokens: number;
  preserveRecentTurns: number;
  fileTracker?: FileTracker;
  summarizeDropped?: boolean;
}

export interface TrimResult {
  messages: Message[];
  droppedMessages: ClassifiedMessage[];
  savedTokens: number;
  summary?: string;
}

/**
 * Trim messages based on priority, lowest priority first
 */
export function trimByPriority(
  messages: Message[],
  options: TrimOptions
): TrimResult {
  const fileTracker = options.fileTracker || FileTracker.fromMessages(messages);
  const currentStep = countSteps(messages);

  // Classify all messages
  const classified = messages.map((message, index) =>
    classifyMessage(message, {
      messageStep: getMessageStep(messages, index),
      currentStep,
      modifiedFiles: fileTracker.getModifiedFiles(),
      recentThreshold: options.preserveRecentTurns,
      preserveRecentTurns: options.preserveRecentTurns,
      isCurrentTask: isCurrentTaskMessage(messages, index),
    })
  );

  // Sort by priority (lowest first = trim first)
  const sortedByPriority = [...classified].sort((a, b) => a.priority - b.priority);

  // Track what we're keeping and dropping
  const keep = new Set(classified);
  const dropped: ClassifiedMessage[] = [];
  let currentTokens = classified.reduce((sum, c) => sum + c.tokens, 0);

  // Remove lowest priority items until within budget
  for (const item of sortedByPriority) {
    if (currentTokens <= options.targetTokens) break;

    // Never remove system or agent instructions
    if (item.priority >= ContentPriority.AGENT_INSTRUCTIONS) {
      continue;
    }

    keep.delete(item);
    dropped.push(item);
    currentTokens -= item.tokens;
  }

  // Reconstruct messages in original order
  const result = classified
    .filter(c => keep.has(c))
    .map(c => c.message);

  // Calculate saved tokens
  const originalTokens = classified.reduce((sum, c) => sum + c.tokens, 0);
  const savedTokens = originalTokens - currentTokens;

  return {
    messages: result,
    droppedMessages: dropped,
    savedTokens,
  };
}

/**
 * Trim with placeholder replacement instead of removal
 */
export function trimWithPlaceholders(
  messages: Message[],
  options: TrimOptions
): TrimResult {
  const result = trimByPriority(messages, options);

  // Instead of removing, replace with placeholders
  const placeholderTokens = 20; // Approximate tokens per placeholder
  const messageMap = new Map(result.messages.map((m, i) => [m, i]));

  const finalMessages = messages.map(message => {
    if (messageMap.has(message)) {
      return message;
    }

    // Create placeholder
    const classified = result.droppedMessages.find(d => d.message === message);
    if (classified && message.role === 'tool') {
      return createPlaceholderMessage(message, classified);
    }

    return message;
  }).filter(m => messageMap.has(m) || m.role === 'tool');

  return {
    ...result,
    messages: finalMessages,
  };
}

function createPlaceholderMessage(
  original: Message,
  classified: ClassifiedMessage
): Message {
  const { metadata, tokens } = classified;

  let placeholder = `[Content truncated`;
  if (metadata.filePath) {
    placeholder += ` - file: ${metadata.filePath}`;
  }
  if (metadata.age !== undefined) {
    placeholder += ` - ${metadata.age} steps ago`;
  }
  placeholder += ` - ${tokens} tokens]`;

  return {
    ...original,
    content: placeholder,
    _truncated: true,
    _originalTokens: tokens,
  };
}
```

---

## Integration

### Update Context Trimmer

```typescript
// source/context/context-trimmer.ts

import { trimByPriority, trimWithPlaceholders } from './priority-trimmer';
import { FileTracker } from './file-tracker';

export function trimConversation(
  messages: Message[],
  targetTokens: number,
  options: {
    strategy: 'age-based' | 'priority-based';
    preserveRecentTurns: number;
    model?: string;
  }
): Message[] {
  if (options.strategy === 'priority-based') {
    const result = trimWithPlaceholders(messages, {
      targetTokens,
      preserveRecentTurns: options.preserveRecentTurns,
    });
    return result.messages;
  }

  // Fall back to age-based trimming from Phase 1
  return trimByAge(messages, targetTokens, options);
}
```

---

## What to Trim First

Summary of trim order (first = most expendable):

1. **Previously summarized content** - Already compressed, low value
2. **Stale tool outputs** - Old bash results, search results (easily re-run)
3. **Old conversation history** - Background context
4. **Old file reads** - Can be re-read if needed
5. **Recent file reads** - Reference material, may still be useful
6. **Recent conversation turns** - Immediate context
7. **Modified files** - Never truncate, user's work in progress
8. **Current task** - Never truncate, active request
9. **Agent instructions** - Never truncate, core behavior
10. **System prompt** - Never truncate, defines the agent

---

## File-Aware Placeholders

When truncating file content, preserve useful metadata:

```typescript
function createFilePlaceholder(message: Message, ref: FileReference): string {
  return `[File: ${ref.path}
  Lines: ${ref.lineCount ?? 'unknown'}
  Last accessed: ${ref.lastAccessStep} steps ago
  Modified: ${ref.wasModified ? 'yes' : 'no'}
  Preview: ${ref.contentPreview?.slice(0, 100) ?? 'N/A'}...

  Use read_file to retrieve current content]`;
}
```

---

## Testing

```typescript
// source/context/priority-trimmer.spec.ts

import test from 'ava';
import { trimByPriority, ContentPriority } from './priority-trimmer';

test('never removes system messages', t => {
  const messages = [
    { role: 'system', content: 'You are a helpful assistant' },
    { role: 'user', content: 'Hello' },
    { role: 'tool', content: 'a'.repeat(10000) },
  ];

  const result = trimByPriority(messages, {
    targetTokens: 100,
    preserveRecentTurns: 1,
  });

  t.true(result.messages.some(m => m.role === 'system'));
});

test('preserves modified files over old reads', t => {
  // Create file tracker with one modified file
  const tracker = new FileTracker();
  tracker.trackAccess('/app/edited.ts', 1, 'edit');
  tracker.trackAccess('/app/read.ts', 1, 'read');

  const messages = [
    { role: 'system', content: 'System' },
    { role: 'tool', name: 'read_file', content: 'edited.ts content...'.repeat(100) },
    { role: 'tool', name: 'read_file', content: 'read.ts content...'.repeat(100) },
  ];

  const result = trimByPriority(messages, {
    targetTokens: 500,
    preserveRecentTurns: 1,
    fileTracker: tracker,
  });

  // Modified file should be preserved
  t.true(result.messages.some(m =>
    m.content.includes('edited.ts')
  ));
});

test('removes old history before recent turns', t => {
  const messages = [
    { role: 'system', content: 'System' },
    { role: 'user', content: 'Old message 1' },
    { role: 'assistant', content: 'Old response 1' },
    // ... 10 more turns ...
    { role: 'user', content: 'Recent message' },
    { role: 'assistant', content: 'Recent response' },
  ];

  const result = trimByPriority(messages, {
    targetTokens: 200,
    preserveRecentTurns: 2,
  });

  // Recent should be preserved, old should be dropped
  t.true(result.messages.some(m => m.content.includes('Recent')));
});

// source/context/file-tracker.spec.ts

test('tracks modified files correctly', t => {
  const tracker = new FileTracker();
  tracker.trackAccess('/app/file.ts', 1, 'read');
  tracker.trackAccess('/app/file.ts', 2, 'edit');

  t.true(tracker.wasModified('/app/file.ts'));
  t.false(tracker.wasModified('/app/other.ts'));
});

test('builds from message history', t => {
  const messages = [
    { role: 'tool', name: 'create_file', content: '{"path": "/app/new.ts"}' },
    { role: 'tool', name: 'read_file', content: '{"path": "/app/existing.ts"}' },
  ];

  const tracker = FileTracker.fromMessages(messages);

  t.true(tracker.wasModified('/app/new.ts'));
  t.false(tracker.wasModified('/app/existing.ts'));
});
```

---

## Next Steps

After completing Phase 2:
1. Verify priority-based trimming preserves important content
2. Test file tracking accuracy across different tool patterns
3. Confirm deterministic behavior with snapshot tests
4. Proceed to Phase 3 (Automatic Summarization)
