# Fix over-fetching in find and search tools

## Priority: Medium (Performance)

## Description

The find-files and search-file-contents tools fetch 3x more results than needed, then discard the excess. This wastes resources, especially in large repositories.

## Affected Files

### `source/tools/find-files.tsx:99-102`
```typescript
head -n ${maxResults * 3}  // Fetches 3x more than needed
```

### `source/tools/search-file-contents.tsx:74-76`
```typescript
head -n ${maxResults * 3}  // Same issue
```

## Proposed Solution

Fetch exactly what's needed:

```typescript
// Before
`find . -name "${pattern}" | head -n ${maxResults * 3}`

// After
`find . -name "${pattern}" | head -n ${maxResults}`
```

If the 3x multiplier was intentional for filtering, apply filters during collection instead:

```typescript
// Stream results and filter as they come in
const results: string[] = [];
for await (const line of lineReader) {
    if (shouldInclude(line) && results.length < maxResults) {
        results.push(line);
    }
    if (results.length >= maxResults) break;
}
```

## Acceptance Criteria

- [ ] Tools fetch only the results they need
- [ ] No 3x over-fetching multiplier
- [ ] Filtering happens during collection, not after
- [ ] Performance improved for large repositories
- [ ] Tests verify correct number of results returned
