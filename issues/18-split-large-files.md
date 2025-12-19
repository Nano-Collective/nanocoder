# Split large files into focused modules

## Priority: Medium

## Description

Several files exceed 800 lines and contain multiple responsibilities. These should be split into focused, single-responsibility modules.

## Affected Files

| File | Lines | Suggested Split |
|------|-------|-----------------|
| `utils/logging/health-monitor.ts` | 1,013 | health-checker.ts, metrics-collector.ts, alert-manager.ts |
| `app.tsx` | 938 | Extract checkpoint logic, mode handlers, chat handlers |
| `utils/logging/log-query.ts` | 911 | query-builder.ts, query-executor.ts, formatters.ts |
| `ai-sdk-client.ts` | 846 | client.ts, retry-handler.ts, response-parser.ts |
| `hooks/useChatHandler.tsx` | 815 | message-processor.ts, tool-executor.ts, state-manager.ts |

## Example: Splitting health-monitor.ts

```
utils/logging/
├── health/
│   ├── index.ts           # Re-exports
│   ├── health-checker.ts  # Core health check logic
│   ├── metrics-collector.ts # Metrics aggregation
│   ├── alert-manager.ts   # Alert sending logic
│   └── types.ts           # Shared types
```

## Acceptance Criteria

- [ ] Each file under 500 lines
- [ ] Single responsibility per module
- [ ] Clear module boundaries
- [ ] No circular dependencies
- [ ] Existing tests still pass
- [ ] Index files for clean imports
