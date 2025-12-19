# Fix async error handling in file-snapshot service

## Priority: Critical

## Description

The file-snapshot service has a nested async catch pattern that doesn't properly handle errors from `fs.mkdir()`. If the directory creation fails, the error is silently swallowed.

## Location

`source/services/file-snapshot.ts:176-178`

```typescript
await fs.access(directory, fs.constants.W_OK).catch(async () => {
    await fs.mkdir(directory, {recursive: true}); // Error swallowed if mkdir fails
});
```

## Proposed Solution

Replace with proper try-catch:

```typescript
try {
    await fs.access(directory, fs.constants.W_OK);
} catch {
    await fs.mkdir(directory, {recursive: true});
}
```

## Acceptance Criteria

- [ ] Errors from `fs.mkdir()` are properly propagated
- [ ] Directory creation still works when directory doesn't exist
- [ ] Tests verify error handling for mkdir failures
