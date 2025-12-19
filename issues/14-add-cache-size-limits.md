# Add size limits to unbounded caches

## Priority: Medium (Performance)

## Description

Several Map-based caches have no size limits, which could lead to memory issues in long-running sessions.

## Affected Files

| File | Location | Cache |
|------|----------|-------|
| `source/vscode/vscode-server.ts` | Line 56-57 | `pendingChanges: Map<string, PendingChange>` |
| `source/hooks/useAppState.tsx` | Line 48-50 | Token cache Map |

## Proposed Solution

Implement LRU (Least Recently Used) cache with size limit:

```typescript
// Option 1: Use a library
import LRUCache from 'lru-cache';

const pendingChanges = new LRUCache<string, PendingChange>({
    max: 1000,
    ttl: 1000 * 60 * 30, // 30 minutes
});

// Option 2: Simple size-limited Map wrapper
class BoundedMap<K, V> extends Map<K, V> {
    constructor(private maxSize: number = 1000) {
        super();
    }

    set(key: K, value: V): this {
        if (this.size >= this.maxSize) {
            // Remove oldest entry
            const firstKey = this.keys().next().value;
            if (firstKey !== undefined) {
                this.delete(firstKey);
            }
        }
        return super.set(key, value);
    }
}
```

## Acceptance Criteria

- [ ] All unbounded caches have size limits
- [ ] Old entries evicted when limit reached
- [ ] Cache behavior documented
- [ ] No memory leaks in long-running sessions
- [ ] Performance not significantly impacted
