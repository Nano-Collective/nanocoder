# Replace console.* calls with structured logger

## Priority: High

## Description

Several files use `console.warn/error/log` instead of the structured pino logger. This bypasses log redaction, structured formatting, and log aggregation.

## Affected Files

| File | Lines | Current Usage |
|------|-------|---------------|
| `source/models/models-cache.ts` | 56, 74 | `console.warn()` for cache errors |
| `source/models/models-dev-client.ts` | 187, 192 | `console.warn()`, `console.log()` |
| `source/components/tool-confirmation.tsx` | 67, 86 | `console.error()` for validator errors |
| `source/app.tsx` | 651, 653 | `console.error()` for non-interactive mode |

## Proposed Solution

Replace with logger calls:

```typescript
// Before
console.warn('Failed to read models cache:', error);

// After
import { getLogger } from '@/utils/logging';
const logger = getLogger();

logger.warn({ error: formatError(error) }, 'Failed to read models cache');
```

## Acceptance Criteria

- [ ] All `console.warn/error/log` replaced with `logger.*`
- [ ] Errors properly formatted using `formatError()`
- [ ] Sensitive data redacted via logging configuration
- [ ] Log output is structured JSON when file logging enabled
- [ ] No `console.*` calls remain in production code (except in logging module itself)
