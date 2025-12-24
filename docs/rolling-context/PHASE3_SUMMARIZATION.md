# Phase 3: Automatic Summarization

## Overview

Instead of dropping tool outputs entirely, generate lightweight summaries that preserve key information without consuming full context.

## Summarization Strategy

**No LLM calls** - use rule-based extraction to keep it fast and free.

```typescript
// source/utils/context-summarizer.ts

interface ToolSummary {
  toolName: string;
  status: 'success' | 'error' | 'partial';
  keyFacts: string[];
  metadata: Record<string, string | number>;
}

function summarizeToolOutput(message: Message): string {
  const summarizer = getSummarizer(message.name);
  const summary = summarizer(message.content);
  return formatSummary(summary);
}
```

## Tool-Specific Summarizers

### read_file

```typescript
function summarizeReadFile(content: string, args: {path: string}): ToolSummary {
  return {
    toolName: 'read_file',
    status: 'success',
    keyFacts: [
      `File: ${args.path}`,
      `Lines: ${countLines(content)}`,
      `Type: ${detectFileType(args.path)}`,
    ],
    metadata: {
      path: args.path,
      lines: countLines(content),
      hasExports: content.includes('export '),
      hasImports: content.includes('import '),
    }
  };
}
// Output: "[read_file: /src/app.ts (245 lines, TypeScript, has exports)]"
```

### execute_bash

```typescript
function summarizeBash(content: string, args: {command: string}): ToolSummary {
  const exitCode = extractExitCode(content);
  const hasError = content.toLowerCase().includes('error');

  return {
    toolName: 'execute_bash',
    status: exitCode === 0 ? 'success' : 'error',
    keyFacts: [
      `Command: ${truncate(args.command, 50)}`,
      `Exit: ${exitCode}`,
      hasError ? 'Contains errors' : 'Completed',
    ],
    metadata: {
      command: args.command,
      exitCode,
      outputLines: countLines(content),
    }
  };
}
// Output: "[bash: npm test | exit 0 | 42 lines output]"
```

### search_files / grep

```typescript
function summarizeSearch(content: string, args: {pattern: string}): ToolSummary {
  const matches = parseSearchResults(content);

  return {
    toolName: 'search_files',
    status: matches.length > 0 ? 'success' : 'partial',
    keyFacts: [
      `Pattern: "${args.pattern}"`,
      `Found: ${matches.length} matches`,
      `Files: ${[...new Set(matches.map(m => m.file))].slice(0, 3).join(', ')}`,
    ],
    metadata: {
      pattern: args.pattern,
      matchCount: matches.length,
      fileCount: new Set(matches.map(m => m.file)).size,
    }
  };
}
// Output: "[search: 'useState' | 15 matches in 4 files: App.tsx, Hook.ts, ...]"
```

## Summary Format

```typescript
function formatSummary(summary: ToolSummary): string {
  const status = summary.status === 'error' ? '❌' : '✓';
  const facts = summary.keyFacts.join(' | ');
  return `[${status} ${summary.toolName}: ${facts}]`;
}
```

## Configuration

```typescript
interface SummarizationConfig {
  enabled: boolean;              // Default: false (opt-in)
  preserveErrors: boolean;       // Always keep full error output
  maxSummaryLength: number;      // Default: 200 chars
  includeMetadata: boolean;      // Include structured metadata
}
```

## Integration

```typescript
function truncateToolResult(
  message: Message,
  age: number,
  config: TruncationConfig
): Message {
  if (config.summarize) {
    const summary = summarizeToolOutput(message);
    return { ...message, content: summary };
  }

  // Fallback to simple placeholder
  return { ...message, content: `[truncated - ${age} steps ago]` };
}
```

## Testing

```typescript
test('summarizes file read with line count', async t => {
  const content = 'line1\nline2\nline3';
  const summary = summarizeReadFile(content, {path: '/app.ts'});
  t.is(summary.metadata.lines, 3);
});

test('preserves full error output', async t => {
  const errorOutput = 'Error: Module not found...';
  const result = summarizeBash(errorOutput, {command: 'npm test'});
  t.is(result.status, 'error');
});
```
