# Extract magic numbers to named constants

## Priority: Medium

## Description

The codebase contains 30+ magic numbers that should be extracted to named constants for clarity and maintainability.

## Examples Found

| Value | File | Purpose |
|-------|------|---------|
| `2000` | `execute-bash.tsx` | Output truncation limit |
| `80`, `95` | `useChatHandler.tsx` | Token usage warning/critical thresholds |
| `100` | `find-files.tsx`, `search-file-contents.tsx` | Default max results |
| `300000` | `app.tsx` | Timeout in ms (5 minutes) |
| `50` | Various | Default limits |
| `4000` | Various | Context truncation |

## Proposed Solution

Create a constants file and extract magic numbers:

```typescript
// source/constants.ts

// Timeouts
export const EXECUTION_TIMEOUT_MS = 300_000; // 5 minutes
export const OUTPUT_FLUSH_DELAY_MS = 1_000;

// Limits
export const DEFAULT_MAX_RESULTS = 100;
export const OUTPUT_TRUNCATION_LIMIT = 2_000;
export const CONTEXT_TRUNCATION_LIMIT = 4_000;

// Token usage thresholds (percentage)
export const TOKEN_WARNING_THRESHOLD = 80;
export const TOKEN_CRITICAL_THRESHOLD = 95;
```

Then use in code:

```typescript
// Before
if (percentUsed >= 95) {

// After
import { TOKEN_CRITICAL_THRESHOLD } from '@/constants';
if (percentUsed >= TOKEN_CRITICAL_THRESHOLD) {
```

## Acceptance Criteria

- [ ] All magic numbers extracted to named constants
- [ ] Constants file created with logical groupings
- [ ] Constants have descriptive names
- [ ] Comments explain non-obvious values
- [ ] Code updated to use constants
