# Phase 2: Tool Definitions Migration - COMPLETE ✅

**Date Completed**: 2025-10-29
**Duration**: ~3 hours 15 minutes
**Tools Migrated**: 10/10 (100%)

## Summary

Successfully migrated all 10 Nanocoder tool definitions to use Vercel AI SDK v5's native `tool()` and `jsonSchema()` helpers. This migration:

- ✅ Maintains full backward compatibility with existing code
- ✅ Prepares tools for Phase 3-4 migration to AI SDK's native message handling
- ✅ Improves type safety with automatic type inference
- ✅ Reduces future conversion code complexity
- ✅ All tests pass (format, types, lint, 200 unit tests)

## Tools Migrated

### File Operations (6 tools)

1. ✅ `read-file.tsx` - File reading with line numbers
2. ✅ `create-file.tsx` - File creation
3. ✅ `insert-lines.tsx` - Line insertion
4. ✅ `replace-lines.tsx` - Line replacement
5. ✅ `delete-lines.tsx` - Line deletion
6. ✅ `read-many-files.tsx` - Bulk file reading

### System & Web Operations (4 tools)

7. ✅ `execute-bash.tsx` - Bash command execution
8. ✅ `web-search.tsx` - Web search via Brave
9. ✅ `fetch-url.tsx` - URL fetching via Jina AI
10. ✅ `search-files.tsx` - Ripgrep-based code search

## Migration Pattern

Each tool now follows this pattern:

```typescript
// 1. Shared execute function (used by both definitions)
const executeToolName = async (args: ToolArgs): Promise<string> => {
  // Implementation
};

// 2. AI SDK tool definition (for Phase 3-4)
const toolNameCoreTool = tool({
  description: '...',
  inputSchema: jsonSchema<ToolArgs>({
    type: 'object',
    properties: {...},
    required: [...],
  }),
  execute: executeToolName,
});

// 3. Nanocoder tool definition (current compatibility wrapper)
export const toolNameTool: ToolDefinition = {
  handler: executeToolName,  // Reuses same execute function
  formatter,                  // Custom UI formatter preserved
  validator,                  // Custom validation preserved
  requiresConfirmation,       // Tool confirmation setting preserved
  config: {...}              // OpenAI-style config for current use
};

// 4. Export for Phase 3-4
export {toolNameCoreTool};
```

## Benefits Achieved

### Type Safety

- AI SDK's `jsonSchema<T>()` provides automatic type inference
- TypeScript ensures parameter types match schema
- Compile-time errors for type mismatches

### Code Reuse

- Single `execute` function shared between both definitions
- No duplication of tool logic
- Easier to maintain and test

### Backward Compatibility

- Existing tool confirmation UI continues working
- Custom formatters and validators preserved
- No changes to app.tsx or tool-handler.tsx required
- Zero breaking changes to user experience

### Future-Ready

- Core tools exported for Phase 3-4 migration
- Prepared for AI SDK's native message handling
- Will enable removal of ~175 lines of conversion code

## Files Modified

### Tool Files (10)

- `source/tools/read-file.tsx`
- `source/tools/create-file.tsx`
- `source/tools/insert-lines.tsx`
- `source/tools/replace-lines.tsx`
- `source/tools/delete-lines.tsx`
- `source/tools/read-many-files.tsx`
- `source/tools/execute-bash.tsx`
- `source/tools/web-search.tsx`
- `source/tools/fetch-url.tsx`
- `source/tools/search-files.tsx`

### Configuration (3)

- `source/types/core.ts` - Exported `tool` and `jsonSchema` helpers
- `knip.json` - Updated to ignore `.phase-3-tools.ts`
- `.phase-3-tools.ts` - Created to document Phase 3-4 exports

### Documentation (1)

- `.nanocoder/PHASE-2-STATUS.md` - Updated with completion status

## Test Results

### All Tests Passing ✅

```
📝 Format check: ✅ All files use Prettier style
🔍 Type check: ✅ No type errors
🔎 Lint check: ✅ Passed (7 pre-existing warnings in ai-sdk-client.ts)
🧩 AVA tests: ✅ 200/200 tests passed
🗑️ Knip: ⚠️ 10 unused exports (intentional - for Phase 3-4)
```

### Knip Warnings Explained

The 10 "unused exports" flagged by knip are the `*CoreTool` exports:

- `readFileCoreTool`
- `createFileCoreTool`
- `insertLinesCoreTool`
- `replaceLinesCoreTool`
- `deleteLinesCoreTool`
- `readManyFilesCoreTool`
- `executeBashCoreTool`
- `webSearchCoreTool`
- `fetchUrlCoreTool`
- `searchFilesCoreTool`

These are intentionally exported but not yet used. They will be consumed in Phase 3-4 when we migrate message handling to use AI SDK's native types.

## Timeline

- **POC (read-file.tsx)**: 30 minutes

  - Established migration pattern
  - Verified backward compatibility
  - Confirmed tests pass

- **Second tool (create-file.tsx)**: 15 minutes

  - Validated pattern works for different tool types
  - Identified any pattern adjustments needed

- **Remaining 8 tools**: 2 hours

  - Applied established pattern
  - Each tool ~15 minutes
  - Consistent, straightforward conversions

- **Testing & knip config**: 30 minutes
  - Fixed formatting issues
  - Updated knip configuration
  - Verified all tests pass

**Total**: ~3 hours 15 minutes

## Key Learnings

1. **Pattern is Robust**: The dual-definition approach works consistently across all tool types
2. **Type Inference Works Well**: AI SDK's `jsonSchema<T>()` provides excellent TypeScript support
3. **No Schema Conversion**: AI SDK accepts standard JSON Schema directly
4. **Zero Breaking Changes**: Complete backward compatibility maintained
5. **Future-Ready**: Tools are prepared for Phase 3-4 without additional work

## Next Phase

### Phase 3: Message Handling Migration

**Goal**: Migrate from custom Message types to AI SDK's native ModelMessage types

**Key Changes**:

- Update `AISDKClient.chat()` to accept and return AI SDK messages
- Migrate message conversion in `message-handler.ts`
- Update tool call handling to use AI SDK's native format
- Remove ~175 lines of conversion code

**Estimated Effort**: 4-6 hours

**Benefits**:

- Simpler code (less conversion logic)
- Better type safety
- Native AI SDK tool calling
- Foundation for Phase 4 (streaming improvements)

See `.nanocoder/AI-SDK-MIGRATION-PROPOSAL.md` for full details.

## Conclusion

Phase 2 is complete and successful. All 10 tools are now using AI SDK's native tool definition format while maintaining full backward compatibility with the existing codebase. The migration pattern is proven and can serve as a reference for any future tools added to Nanocoder.

Ready to proceed to Phase 3 when desired. 🚀
