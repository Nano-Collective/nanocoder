# Replace insecure Math.random() with crypto

## Priority: High (Security)

## Description

Several files use `Math.random()` for generating IDs, which is not cryptographically secure and produces predictable values. While the codebase correctly uses `crypto.randomBytes()` in some places (e.g., correlation.ts), other areas use the insecure alternative.

## Affected Files

| File | Line | Usage |
|------|------|-------|
| `source/usage/tracker.ts` | 27 | Session ID generation |
| `source/ai-sdk-client.ts` | 528, 634, 660, 679 | Tool ID generation |
| `source/utils/logging/request-tracker.ts` | 557 | Request ID generation |

## Current Pattern

```typescript
`${Date.now()}-${Math.random().toString(36).substring(7)}`
```

## Proposed Solution

Use Node.js crypto module:

```typescript
import { randomBytes, randomUUID } from 'node:crypto';

// For UUIDs
const id = randomUUID();

// For hex strings
const id = randomBytes(8).toString('hex');
```

## Acceptance Criteria

- [ ] All `Math.random()` usage for IDs replaced with crypto functions
- [ ] Consistent ID generation pattern across codebase
- [ ] No breaking changes to ID formats used in external APIs
- [ ] Tests verify ID uniqueness
