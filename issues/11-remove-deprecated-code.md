# Remove deprecated functions

## Priority: High

## Description

Several deprecated functions remain in the codebase with deprecation warnings. These should be removed or callers migrated to recommended alternatives.

## Affected Files

### `source/utils/logging/correlation.ts`
- `setCorrelationContext()` (line 219) - DEPRECATED
- `clearCorrelationContext()` (line 233) - DEPRECATED
- `addCorrelationMetadata()` (line 403) - DEPRECATED

### `source/tools/tool-manager.ts`
- `getNativeToolsRegistry()` (line 109) - marked `@deprecated`

### `source/utils/file-autocomplete.ts`
- `fuzzyScore()` (line 105) - deprecated wrapper, should use `fuzzyScoreFilePath` directly

## Proposed Solution

1. Search for any remaining callers of deprecated functions
2. Migrate callers to recommended alternatives
3. Remove deprecated function definitions
4. Update any related documentation

For correlation functions, the alternatives are:
- `setCorrelationContext` → `withCorrelationContext()` or `withNewCorrelationContext()`
- `clearCorrelationContext` → Automatic cleanup with AsyncLocalStorage
- `addCorrelationMetadata` → `withNewCorrelationContext()` with metadata parameter

## Acceptance Criteria

- [ ] All deprecated functions removed
- [ ] No callers of deprecated functions remain
- [ ] Alternatives documented if not already
- [ ] No breaking changes to public APIs
- [ ] Tests updated to use new functions
