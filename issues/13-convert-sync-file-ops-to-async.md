# Convert synchronous file operations to async

## Priority: Medium (Performance)

## Description

Several files use synchronous file operations (`readFileSync`, `writeFileSync`, `existsSync`) which block the Node.js event loop. These should be converted to async operations.

## Affected Files

| File | Lines | Operations |
|------|-------|------------|
| `source/models/models-cache.ts` | 32-33, 45, 72 | `existsSync`, `mkdirSync`, `readFileSync`, `writeFileSync` |
| `source/vscode/vscode-server.ts` | 24-25 | `readFileSync` at module load |
| `source/commands/help.tsx` | 14-15 | `readFileSync` in render |
| `source/hooks/useVSCodeServer.tsx` | 227 | `readFileSync` in helper |

## Proposed Solution

Convert to async using `fs/promises`:

```typescript
// Before
import { readFileSync, existsSync, mkdirSync } from 'fs';

if (!existsSync(cacheDir)) {
    mkdirSync(cacheDir, { recursive: true });
}
const data = readFileSync(cachePath, 'utf-8');

// After
import { readFile, mkdir, access } from 'fs/promises';
import { constants } from 'fs';

try {
    await access(cacheDir, constants.F_OK);
} catch {
    await mkdir(cacheDir, { recursive: true });
}
const data = await readFile(cachePath, 'utf-8');
```

For module-level reads (like version from package.json), consider:
1. Moving to async initialization
2. Caching at build time
3. Using dynamic import

## Acceptance Criteria

- [ ] All sync file operations converted to async
- [ ] No blocking I/O in hot paths
- [ ] Module initialization handles async properly
- [ ] Error handling preserved
- [ ] Tests verify async behavior
