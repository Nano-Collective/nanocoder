# Phase 2: File-Aware Retrieval

## Overview

Intelligently preserve file contents based on recency and relevance, avoiding re-reads of recently accessed files.

## File Reference Tracking

```typescript
// source/utils/file-tracker.ts

interface FileReference {
  path: string;
  lastAccessStep: number;
  lastAccessTime: number;
  contentPreview: string;      // First 200 chars
  lineCount: number;
  wasModified: boolean;        // If we wrote to this file
}

class FileTracker {
  private references: Map<string, FileReference> = new Map();

  trackFileAccess(path: string, step: number, content: string): void;
  trackFileModification(path: string, step: number): void;
  getRecentFiles(currentStep: number, maxAge: number): FileReference[];
  isFileStale(path: string, currentStep: number, maxAge: number): boolean;
}
```

## Integration with Truncation

Modify truncation logic to check file recency:

```typescript
function truncateToolResult(
  message: Message,
  age: number,
  config: TruncationConfig,
  fileTracker: FileTracker
): Message {
  // Don't truncate if file was recently accessed elsewhere
  if (message.name === 'read_file') {
    const filePath = extractFilePath(message);
    if (filePath && !fileTracker.isFileStale(filePath, currentStep, config.maxAge)) {
      return message;  // Preserve - file is still "active"
    }
  }

  // Standard truncation with file metadata preserved
  return {
    ...message,
    content: createFileStub(message),
  };
}

function createFileStub(message: Message): string {
  const filePath = extractFilePath(message);
  const lineCount = countLines(message.content);
  return `[File: ${filePath} (${lineCount} lines) - content truncated, use read_file to re-read]`;
}
```

## Truncation Priorities

1. **Never truncate**: Files modified in this session (we wrote to them)
2. **Preserve longer**: Files referenced by user in messages
3. **Standard retention**: Files read by tools
4. **Aggressive truncation**: Search results, bash outputs (easily re-runnable)

```typescript
function getTruncationPriority(message: Message, fileTracker: FileTracker): number {
  if (message.name === 'create_file' || message.name === 'edit_file') {
    return Infinity;  // Never truncate our writes
  }
  if (message.name === 'read_file') {
    const path = extractFilePath(message);
    if (fileTracker.wasModified(path)) return Infinity;
    return 2;  // Higher priority to preserve
  }
  if (message.name === 'search_files' || message.name === 'execute_bash') {
    return 0;  // Can be re-run easily
  }
  return 1;  // Default
}
```

## Re-Read Optimization

When file content is truncated, add hint for re-reading:

```typescript
const TRUNCATED_FILE_HINT = `
[File content truncated. To see current content, call read_file again.
Path: {path}
Last read: {age} steps ago
Lines: {lineCount}]
`;
```

## Testing

```typescript
test('preserves recently modified files', async t => {
  const tracker = new FileTracker();
  tracker.trackFileModification('/app/config.ts', 1);

  const messages = createMessagesWithFileRead('/app/config.ts', step=1);
  // Add 10 more steps...

  const result = truncateWithFileAwareness(messages, tracker);
  t.false(result.find(m => m.name === 'read_file').content.includes('truncated'));
});

test('truncates stale file reads', async t => {
  // File read 10 steps ago, never modified
});
```
