# Phase 1: Tool Output Truncation

**Prerequisite:** Phase 0 (command & preference) must be complete.

## Overview

Drop tool result content from messages older than N steps while preserving message structure for conversation coherence.

**Only runs when `rollingContextEnabled === true`** (set via `/rolling-context` command).

## Core Logic

### Step Tracking

A "step" = one assistant turn (may include multiple tool calls). Track steps via assistant messages with `tool_calls`.

```typescript
// source/utils/context-manager.ts

interface TruncationConfig {
  maxAge: number;              // Steps before truncation (default: 5)
  maxTokensPerOutput: number;  // Max tokens per tool result (default: 2000)
  placeholder: string;         // Default: "[content truncated - {N} steps ago]"
}

const DEFAULT_CONFIG: TruncationConfig = {
  maxAge: 5,
  maxTokensPerOutput: 2000,
  placeholder: "[content truncated - {age} steps ago]"
};
```

### Truncation Algorithm

```typescript
function truncateOldToolOutputs(
  messages: Message[],
  config: TruncationConfig = DEFAULT_CONFIG
): Message[] {
  // 1. Count steps (assistant messages with tool_calls)
  const steps = countSteps(messages);

  // 2. Walk messages, tag each with its step number
  const taggedMessages = tagMessagesWithStep(messages);

  // 3. Truncate tool results older than maxAge
  return taggedMessages.map(({message, step}) => {
    if (message.role !== 'tool') return message;

    const age = steps - step;
    if (age > config.maxAge) {
      return truncateToolResult(message, age, config);
    }
    return message;
  });
}

function countSteps(messages: Message[]): number {
  return messages.filter(m =>
    m.role === 'assistant' && m.tool_calls?.length
  ).length;
}

function truncateToolResult(
  message: Message,
  age: number,
  config: TruncationConfig
): Message {
  const placeholder = config.placeholder.replace('{age}', String(age));
  return {
    ...message,
    content: placeholder,
    _originalLength: message.content.length,  // Metadata for debugging
    _truncatedAt: age
  };
}
```

### Integration

In `source/hooks/chat-handler/use-chat-handler.tsx`:

```typescript
import {getRollingContextEnabled} from '@/config/preferences';
import {truncateOldToolOutputs} from '@/utils/context-manager';

// Before sending to LLM
const processedMessages = getRollingContextEnabled()
  ? truncateOldToolOutputs(messages, contextConfig)
  : messages;

const response = await client.chat(processedMessages, tools, callbacks);
```

Or pass `rollingContextEnabled` from app state via props for better testability.

## Edge Cases

1. **Tool chains**: If tool A's output feeds tool B, preserve both if B is recent
2. **Error messages**: Always preserve error content (valuable for debugging)
3. **Small outputs**: Don't truncate outputs under 100 tokens
4. **User-referenced content**: If user quotes tool output, preserve it

## Testing

```typescript
// source/utils/context-manager.spec.ts

test('truncates tool outputs older than maxAge', async t => {
  const messages = [
    {role: 'user', content: 'read file.txt'},
    {role: 'assistant', content: '', tool_calls: [{id: '1', function: {name: 'read_file', arguments: {}}}]},
    {role: 'tool', tool_call_id: '1', name: 'read_file', content: 'very long content...'},
    // ... 6 more steps
  ];

  const result = truncateOldToolOutputs(messages, {maxAge: 5});
  t.true(result[2].content.includes('[content truncated'));
});

test('preserves recent tool outputs', async t => {
  // ...
});

test('preserves error messages regardless of age', async t => {
  // ...
});
```
