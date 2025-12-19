# Fix silent configuration failure

## Priority: Critical

## Description

The config loading code has an empty catch block that silently swallows errors when loading `agents.config.json`. Users may run with unexpected defaults without knowing their configuration failed to load.

## Location

`source/config/index.ts:104-106`

```typescript
} catch {
    //
}
```

## Proposed Solution

Add error logging or user notification when config fails to load:

```typescript
} catch (error) {
    logger.warn('Failed to load agents.config.json', {
        error: error instanceof Error ? error.message : String(error)
    });
}
```

## Acceptance Criteria

- [ ] Config loading errors are logged with appropriate context
- [ ] Users can see when their config file has issues
- [ ] Existing behavior of falling back to defaults is preserved
- [ ] Tests added for error handling path
